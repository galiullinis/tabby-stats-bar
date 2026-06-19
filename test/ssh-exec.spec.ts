import { execSshCommand } from '../src/services/ssh-exec'

const tick = (ms = 5) => new Promise(r => setTimeout(r, ms))

function makeChannel() {
    const subscribers: Array<{ next: (d: any) => void; error?: (e: any) => void }> = []
    const state = { closed: false, unsubscribed: false }
    const channel: any = {
        data$: {
            subscribe(next: (d: any) => void, error?: (e: any) => void) {
                subscribers.push({ next, error })
                return { unsubscribe: () => { state.unsubscribed = true } }
            },
        },
        requestExec: jest.fn(() => Promise.resolve()),
        close: () => { state.closed = true },
        emit: (chunk: any) => subscribers.forEach(s => s.next(chunk)),
        emitError: (e: any) => subscribers.forEach(s => s.error && s.error(e)),
        state,
    }
    return channel
}

function makeClient(channel: any, overrides: Partial<any> = {}) {
    return {
        openSessionChannel: async () => 'raw-channel',
        activateChannel: async () => channel,
        ...overrides,
    }
}

describe('execSshCommand', () => {
    it('resolves with the buffer once the end marker is seen and tears down', async () => {
        const channel = makeChannel()
        const p = execSshCommand(makeClient(channel), 'mycmd', { endMarker: 'END', timeoutMs: 1000 })
        await tick()
        expect(channel.requestExec).toHaveBeenCalledWith('mycmd')
        channel.emit('hello ')
        channel.emit('world END trailing')
        await expect(p).resolves.toContain('END')
        expect(channel.state.unsubscribed).toBe(true)
        expect(channel.state.closed).toBe(true)
    })

    it('cleans up channel AND subscription on timeout (the leak that was fixed)', async () => {
        const channel = makeChannel()
        const p = execSshCommand(makeClient(channel), 'mycmd', { endMarker: 'END', timeoutMs: 20 })
        await expect(p).rejects.toThrow('Timeout')
        expect(channel.state.unsubscribed).toBe(true)
        expect(channel.state.closed).toBe(true)
    })

    it('rejects and tears down on stream error', async () => {
        const channel = makeChannel()
        const p = execSshCommand(makeClient(channel), 'mycmd', { endMarker: 'END', timeoutMs: 1000 })
        await tick()
        channel.emitError(new Error('boom'))
        await expect(p).rejects.toThrow('boom')
        expect(channel.state.unsubscribed).toBe(true)
        expect(channel.state.closed).toBe(true)
    })

    it('rejects when channel opening fails', async () => {
        const client = makeClient(makeChannel(), {
            openSessionChannel: async () => { throw new Error('no channel') },
        })
        await expect(execSshCommand(client, 'cmd', { timeoutMs: 1000 })).rejects.toThrow('no channel')
    })

    it('rejects when channel has no data$ observable', async () => {
        const channel: any = { requestExec: async () => {}, close: () => {} }
        await expect(execSshCommand(makeClient(channel), 'cmd', { timeoutMs: 1000 }))
            .rejects.toThrow('data$')
    })

    it('rejects when channel exposes neither requestExec nor exec', async () => {
        const channel = makeChannel()
        delete channel.requestExec
        const p = execSshCommand(makeClient(channel), 'cmd', { timeoutMs: 1000 })
        await expect(p).rejects.toThrow('requestExec or exec')
        expect(channel.state.unsubscribed).toBe(true)
    })

    it('does not resolve twice if data keeps arriving after the end marker', async () => {
        const channel = makeChannel()
        const p = execSshCommand(makeClient(channel), 'cmd', { endMarker: 'END', timeoutMs: 1000 })
        await tick()
        channel.emit('END')
        const first = await p
        // late data must not throw or change the resolved value
        channel.emit('more data')
        expect(first).toContain('END')
    })
})
