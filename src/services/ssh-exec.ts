// Minimal shape of the SSH client/channel we rely on. Kept loose (`any`-ish)
// because Tabby's SSH types are not exported in a stable way.
export interface SshChannelLike {
    data$?: { subscribe: (next: (data: any) => void, error?: (err: any) => void) => { unsubscribe: () => void } }
    requestExec?: (cmd: string) => Promise<any>
    exec?: (cmd: string) => Promise<any>
    close?: () => void
}

export interface SshClientLike {
    openSessionChannel: () => Promise<any>
    activateChannel: (channel: any) => Promise<SshChannelLike>
}

export interface ExecOptions {
    timeoutMs?: number
    endMarker?: string
    decode?: (chunk: any) => string
}

const defaultDecode = (() => {
    const decoder = typeof TextDecoder !== 'undefined' ? new TextDecoder('utf-8') : null
    return (chunk: any): string => {
        if (typeof chunk === 'string') {
            return chunk
        }
        if (decoder && (chunk instanceof ArrayBuffer || ArrayBuffer.isView(chunk))) {
            return decoder.decode(chunk, { stream: true })
        }
        return chunk != null ? chunk.toString() : ''
    }
})()

/**
 * Run a command over an SSH session channel and resolve with the accumulated
 * stdout once `endMarker` is seen.
 *
 * Crucially, the channel and the data$ subscription are ALWAYS cleaned up —
 * on success, on stream error, and on timeout. The previous implementation used
 * Promise.race() with a separate timeout and never tore down the channel /
 * subscription when the timeout won, leaking one SSH channel + RxJS subscription
 * on every slow poll (every 3s per tab), which accumulated into a UI freeze.
 */
export function execSshCommand(
    sshClient: SshClientLike,
    cmd: string,
    opts: ExecOptions = {}
): Promise<string> {
    const timeoutMs = opts.timeoutMs ?? 5000
    const endMarker = opts.endMarker ?? 'TABBY-STATS-END'
    const decode = opts.decode ?? defaultDecode

    return new Promise<string>((resolve, reject) => {
        let channel: SshChannelLike | null = null
        let subscription: { unsubscribe: () => void } | null = null
        let timer: any = null
        let settled = false

        const cleanup = () => {
            if (timer) {
                clearTimeout(timer)
                timer = null
            }
            if (subscription) {
                try { subscription.unsubscribe() } catch { /* ignore */ }
                subscription = null
            }
            if (channel && typeof channel.close === 'function') {
                try { channel.close() } catch { /* ignore */ }
            }
            channel = null
        }

        const finish = (err: any, value?: string) => {
            if (settled) {
                return
            }
            settled = true
            cleanup()
            if (err) {
                reject(err)
            } else {
                resolve(value as string)
            }
        }

        timer = setTimeout(() => finish(new Error('Stats: Timeout')), timeoutMs)

        const start = async () => {
            let openedChannel: SshChannelLike
            try {
                const newChannel = await sshClient.openSessionChannel()
                openedChannel = await sshClient.activateChannel(newChannel)
            } catch (err) {
                finish(err)
                return
            }

            // If we already timed out while the channel was opening, close the
            // freshly-opened channel right away so it does not leak.
            if (settled) {
                try { openedChannel.close && openedChannel.close() } catch { /* ignore */ }
                return
            }
            channel = openedChannel

            let buffer = ''
            const processData = (chunk: any) => {
                buffer += decode(chunk)
                if (buffer.includes(endMarker)) {
                    finish(null, buffer)
                }
            }

            if (!channel.data$) {
                finish(new Error('Channel has no data$ observable'))
                return
            }
            subscription = channel.data$.subscribe(
                (data: any) => processData(data),
                (err: any) => finish(err || new Error('Stats: Data Stream Error'))
            )

            const execFn = typeof channel.requestExec === 'function'
                ? channel.requestExec.bind(channel)
                : typeof channel.exec === 'function'
                    ? channel.exec.bind(channel)
                    : null

            if (!execFn) {
                finish(new Error('Channel has no requestExec or exec method'))
                return
            }

            execFn(cmd).catch((err: any) => finish(err))
        }

        start()
    })
}
