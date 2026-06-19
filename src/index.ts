import { NgModule, ComponentFactoryResolver, ApplicationRef, Injector, EmbeddedViewRef } from '@angular/core'
import { CommonModule } from '@angular/common'
import { FormsModule } from '@angular/forms'
import { NgbModule } from '@ng-bootstrap/ng-bootstrap'
import TabbyCoreModule, { ToolbarButtonProvider, ConfigProvider, TranslateService, AppService, ConfigService } from 'tabby-core'
import { SettingsTabProvider } from 'tabby-settings'
import { NgChartsModule } from 'ng2-charts'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

import { ServerStatsConfigProvider } from './config'
import { clampPollIntervalMs, nextBackoffMs } from './services/poll-timing'
import { TRANSLATIONS } from './translations'
import { StatsService } from './services/stats.service'
import { StatsToolbarButtonProvider } from './toolbar-button.provider'
import { ServerStatsFloatingPanelComponent } from './components/floating-panel.component'
import { ServerStatsBottomBarComponent } from './components/bottom-bar.component'
import { ServerStatsSettingsComponent, ServerStatsSettingsTabProvider } from './components/settings.component'

type TabInstance = {
    teardown: () => void
    // Returns false when a fetch was attempted but produced no data (drives backoff).
    runPoll: () => Promise<boolean> | boolean
    collector: () => Promise<any>
    state: any
    configSub: any
}

const LOG_PATH = path.join(os.tmpdir(), 'tabby-server-stats.log')

// Logging is OFF by default. It is enabled only when the user turns on the
// `debug` flag in the plugin settings. Previously logDebug() did a synchronous
// fs.appendFileSync() on the renderer thread for every state event and the log
// grew without bound — both undesirable for a perf-sensitive plugin.
let debugLoggingEnabled = false
export const setDebugLogging = (enabled: boolean) => { debugLoggingEnabled = !!enabled }
const logDebug = (message: string) => {
    if (!debugLoggingEnabled) {
        return
    }
    try {
        fs.appendFileSync(LOG_PATH, `${new Date().toISOString()} ${message}\n`)
    } catch {}
}

@NgModule({
    imports: [CommonModule, FormsModule, NgChartsModule, TabbyCoreModule, NgbModule], 
    declarations: [ServerStatsFloatingPanelComponent, ServerStatsBottomBarComponent, ServerStatsSettingsComponent],
    entryComponents: [ServerStatsFloatingPanelComponent, ServerStatsBottomBarComponent, ServerStatsSettingsComponent],
    providers: [
        { provide: ConfigProvider, useClass: ServerStatsConfigProvider, multi: true },
        { provide: ToolbarButtonProvider, useClass: StatsToolbarButtonProvider, multi: true },
        { provide: SettingsTabProvider, useClass: ServerStatsSettingsTabProvider, multi: true }, 
        StatsService
    ]
})
export default class ServerStatsModule {
    private floatingRef: any = null
    private floatingElem: HTMLElement | null = null
    private activeDisplayMode: string | null = null
    private tabInstances: WeakMap<HTMLElement, TabInstance> = new WeakMap()
    private attachedTabs = new Set<HTMLElement>()
    private tabElementMap = new Map<HTMLElement, any>()
    private disposables: Array<() => void> = []
    private styleNode: HTMLStyleElement | null = null
    private retryTimer: any = null
    private failed = false
    private scanTimer: any = null
    private pollTimer: any = null
    private pollBackoffMs = 0
    // Cache of the last leaf-tab list, so rebuildTabElementMap() can skip work
    // when the set of tabs has not actually changed.
    private cachedLeafTabs: any[] = []

    constructor(
        private app: AppService, 
        private config: ConfigService,
        private componentFactoryResolver: ComponentFactoryResolver,
        private appRef: ApplicationRef,
        private injector: Injector,
        private statsService: StatsService,
        translate: TranslateService
    ) {
        this.syncDebugLogging()
        logDebug('[init] constructor start')
        this.config.ready$.subscribe(() => {
            this.syncDebugLogging()
            setTimeout(() => {
                this.safeRun('translations', () => {
                    for (const [lang, trans] of Object.entries(TRANSLATIONS)) {
                        translate.setTranslation(lang, trans, true);
                    }
                })
            }, 1000);
        });

        this.config.ready$.subscribe(() => {
            setTimeout(() => {
                logDebug('[event] config.ready')
                this.safeRun('applyDisplayMode:ready', () => this.applyDisplayMode(this.getDisplayMode()))
            }, 500);
        })

        this.config.changed$.subscribe(() => {
            this.syncDebugLogging()
            logDebug('[event] config.changed')
            this.safeRun('applyDisplayMode:changed', () => this.applyDisplayMode(this.getDisplayMode()))
        })
        logDebug('[init] constructor end')
    }

    private syncDebugLogging() {
        setDebugLogging(!!this.config.store?.plugin?.serverStats?.debug)
    }

    private getDisplayMode() {
        return this.config.store.plugin?.serverStats?.displayMode || 'bottomBar'
    }

    private safeRun(label: string, fn: () => void) {
        if (this.failed) {
            return
        }
        try {
            fn()
        } catch (err) {
            this.failed = true
            logDebug(`[error] ${label}: ${err instanceof Error ? err.stack || err.message : String(err)}`)
        }
    }

    private applyDisplayMode(mode: string) {
        logDebug(`[state] applyDisplayMode ${mode}`)
        const previousMode = this.activeDisplayMode
        this.activeDisplayMode = mode

        if (previousMode === mode) {
            if (mode === 'bottomBar' && this.attachedTabs.size === 0) {
                this.initializePerTabBars()
            }
            return
        }

        this.destroyFloating()
        this.teardownAllTabs()

        if (mode === 'floatingPanel') {
            this.safeRun('createFloatingPanel', () => this.createFloatingPanel())
        } else {
            this.safeRun('ensureGlobalStyle', () => this.ensureGlobalStyle())
            this.safeRun('initializePerTabBars', () => this.initializePerTabBars())
        }
    }

    private createFloatingPanel() {
        logDebug('[state] createFloatingPanel')
        const floatingFactory = this.componentFactoryResolver.resolveComponentFactory(ServerStatsFloatingPanelComponent)
        this.floatingRef = floatingFactory.create(this.injector)
        this.appRef.attachView(this.floatingRef.hostView)
        this.floatingElem = (this.floatingRef.hostView as EmbeddedViewRef<any>).rootNodes[0] as HTMLElement
        document.body.appendChild(this.floatingElem);
        this.floatingRef.changeDetectorRef.detectChanges();
        setTimeout(() => this.floatingRef.instance.checkAndFetch(), 100);
    }

    private initializePerTabBars() {
        logDebug('[state] initializePerTabBars')
        this.safeRun('rebuildTabElementMap', () => this.rebuildTabElementMap())
        this.safeRun('attachExistingTabs', () => this.attachExistingTabs())
        this.safeRun('observeTabLifecycle', () => this.observeTabLifecycle())
        this.safeRun('startScanTimer', () => this.startScanTimer())
        this.safeRun('startPollTimer', () => this.startPollTimer())
    }

    private getPollIntervalMs(): number {
        return clampPollIntervalMs(this.config.store?.plugin?.serverStats?.pollInterval)
    }

    // Single central poll loop for ALL per-tab bars. Only the bar(s) belonging to
    // the currently active top-level tab are fetched — background tabs (and panes
    // in non-active split tabs) are skipped entirely.
    //
    // It is a SELF-RESCHEDULING loop (setTimeout, not setInterval): the next poll
    // is scheduled only AFTER the current one settles, which structurally prevents
    // overlap even at very short intervals. On failure it backs off exponentially.
    private startPollTimer() {
        if (this.pollTimer) {
            return
        }
        this.scheduleNextPoll(0)
    }

    private scheduleNextPoll(delay: number) {
        this.pollTimer = window.setTimeout(async () => {
            this.pollTimer = null
            if (this.activeDisplayMode !== 'bottomBar') {
                // Stay alive but idle; re-check at the normal cadence.
                this.scheduleNextPoll(this.getPollIntervalMs())
                return
            }
            let ok = true
            try {
                ok = await this.pollActiveTabsOnce()
            } catch {
                ok = false
            }
            this.pollBackoffMs = nextBackoffMs(this.pollBackoffMs, !ok)
            this.scheduleNextPoll(this.getPollIntervalMs() + this.pollBackoffMs)
        }, delay)
    }

    // Polls every active bar once, awaiting them all. Returns false only when a
    // poll was attempted and produced no data (error/timeout) — that drives the
    // backoff. "Nothing to poll" / "intentionally hidden" count as success.
    private async pollActiveTabsOnce(): Promise<boolean> {
        const polls: Array<Promise<boolean>> = []
        this.attachedTabs.forEach(el => {
            if (!this.isSshTabActive(el)) {
                return
            }
            const instance = this.tabInstances.get(el)
            if (instance && typeof instance.runPoll === 'function') {
                polls.push(Promise.resolve(instance.runPoll()).then(r => r !== false).catch(() => false))
            }
        })
        if (!polls.length) {
            return true
        }
        const results = await Promise.all(polls)
        return results.some(r => r)
    }

    // An ssh-tab is "active" when it lives inside the currently active top-level
    // tab. For a split tab this matches every visible pane; for a hidden tab it is
    // false. Falls back to on-screen visibility when the tab element can't be
    // resolved, so we never silently stop updating a visible bar.
    private isSshTabActive(sshTabEl: HTMLElement): boolean {
        const activeTab = this.app.activeTab
        if (!activeTab) {
            return false
        }
        const activeEl = this.getTabElement(activeTab)
        if (activeEl) {
            return activeEl === sshTabEl || activeEl.contains(sshTabEl) || sshTabEl.contains(activeEl)
        }
        return sshTabEl.offsetParent !== null
    }

    private ensureGlobalStyle() {
        if (this.styleNode) {
            return
        }
        if (!document.head) {
            this.scheduleRetry()
            return
        }
        logDebug('[state] ensureGlobalStyle')
        const style = document.createElement('style')
        style.setAttribute('data-server-stats-style', '1')
        style.textContent = `
            ssh-tab.server-stats-tab {
                display: flex;
                flex-direction: column;
            }
            ssh-tab.server-stats-tab > .server-stats-bottom-host {
                flex: 0 0 auto;
                width: 100%;
            }
            ssh-tab.server-stats-tab > *:not(.server-stats-bottom-host) {
                flex: 1 1 auto;
                min-height: 0;
            }
            .server-stats-bottom-host {
                width: 100%;
            }
        `
        document.head.appendChild(style)
        this.styleNode = style
    }

    private attachExistingTabs() {
        const content = document.querySelector('app-root > div > .content')
        if (!content) {
            logDebug('[state] attachExistingTabs: no content')
            this.scheduleRetry()
            return
        }
        this.rebuildTabElementMap()
        const candidates = content.querySelectorAll('ssh-tab')
        logDebug(`[state] attachExistingTabs ${candidates.length}`)
        candidates.forEach(el => this.attachToSshTab(el as HTMLElement))
    }

    // The plugin used to run a global MutationObserver with `subtree: true` over
    // the whole `.content` area to detect new ssh-tab elements. That made it react
    // to xterm.js's constant in-terminal DOM churn — a main-thread CPU hot path that
    // could freeze the entire UI. Tab discovery is now driven exclusively by Tabby's
    // own lifecycle observables (tabOpened$ / tabsChanged$ / tabRemoved$ / tabClosed$)
    // plus a light periodic scan timer (startScanTimer). No DOM mutation watching.
    private scheduleRetry() {
        if (this.retryTimer) {
            return
        }
        logDebug('[state] scheduleRetry')
        this.retryTimer = window.setTimeout(() => {
            this.retryTimer = null
            if (this.activeDisplayMode === 'bottomBar') {
                logDebug('[state] retry tick')
                this.safeRun('ensureGlobalStyle:retry', () => this.ensureGlobalStyle())
                this.safeRun('attachExistingTabs:retry', () => this.attachExistingTabs())
            }
        }, 250)
    }

    private startScanTimer() {
        if (this.scanTimer) {
            return
        }
        this.scanTimer = window.setInterval(() => {
            if (this.activeDisplayMode !== 'bottomBar') {
                return
            }
            this.attachExistingTabs()
        }, 1500)
    }

    private attachToSshTab(sshTabEl: HTMLElement) {
        if (this.activeDisplayMode !== 'bottomBar') {
            return
        }
        if (!sshTabEl || this.tabInstances.has(sshTabEl) || sshTabEl.getAttribute('data-ss-attached') === '1') {
            return
        }
        logDebug('[state] attachToSshTab')

        // Note: attachExistingTabs() rebuilds the tab/element map before iterating,
        // so we intentionally do NOT rebuild it again per attached tab here.
        sshTabEl.setAttribute('data-ss-attached', '1')
        sshTabEl.classList.add('server-stats-tab')

        const host = document.createElement('div')
        host.classList.add('server-stats-bottom-host')
        host.setAttribute('data-ss-host', '1')
        sshTabEl.appendChild(host)

        const barFactory = this.componentFactoryResolver.resolveComponentFactory(ServerStatsBottomBarComponent)
        const barRef = barFactory.create(this.injector)
        const session = this.resolveSessionForElement(sshTabEl)
        if ((barRef.instance as any).useExternalController !== undefined) {
            (barRef.instance as any).useExternalController = true
        }
        if ((barRef.instance as any).bindToSession) {
            (barRef.instance as any).bindToSession(session)
        }
        this.appRef.attachView(barRef.hostView)
        const barElem = (barRef.hostView as EmbeddedViewRef<any>).rootNodes[0] as HTMLElement
        host.appendChild(barElem)
        barRef.changeDetectorRef.detectChanges()

        const state: any = { last: null }
        let activeSession: any = session
        const collector = async () => {
            const resolvedSession = this.resolveSessionForElement(sshTabEl)
            if (resolvedSession && resolvedSession !== activeSession) {
                activeSession = resolvedSession
                if ((barRef.instance as any).bindToSession) {
                    (barRef.instance as any).bindToSession(activeSession)
                }
            }
            if (!activeSession) {
                return { data: null, session: null, supported: false }
            }
            const supported = this.statsService.isPlatformSupport(activeSession)
            if (!supported) {
                return { data: null, session: activeSession, supported: false }
            }
            const data = await this.statsService.fetchStats(activeSession)
            return { data, session: activeSession, supported: true }
        }

        // Returns true on success or when intentionally hidden; false only when a
        // fetch was attempted but yielded no data (so the scheduler can back off).
        const runPoll = async (): Promise<boolean> => {
            const isEnabled = this.config.store.plugin?.serverStats?.enabled
            const displayMode = this.getDisplayMode()
            if (!isEnabled || displayMode !== 'bottomBar') {
                if ((barRef.instance as any).hideExternal) {
                    (barRef.instance as any).hideExternal()
                }
                return true
            }
            const result = await collector()
            if (!result || !result.session || !result.supported) {
                if ((barRef.instance as any).hideExternal) {
                    (barRef.instance as any).hideExternal()
                }
                return true
            }
            if (result.data) {
                state.last = result.data
                if ((barRef.instance as any).renderExternalStats) {
                    (barRef.instance as any).renderExternalStats(result.data)
                }
                return true
            }
            if ((barRef.instance as any).setExternalLoading) {
                (barRef.instance as any).setExternalLoading(false)
            }
            return false
        }

        const syncOnConfigChange = () => {
            const isEnabled = this.config.store.plugin?.serverStats?.enabled
            const displayMode = this.getDisplayMode()
            if (!isEnabled || displayMode !== 'bottomBar') {
                if ((barRef.instance as any).hideExternal) {
                    (barRef.instance as any).hideExternal()
                }
                return
            }
            if ((barRef.instance as any).setExternalLoading) {
                (barRef.instance as any).setExternalLoading(true)
            }
            runPoll()
        }

        // Initial fetch on attach (so the bar has data even before it becomes the
        // active tab). Steady-state polling is driven centrally by startPollTimer()
        // for the active tab only — no per-tab interval here anymore.
        syncOnConfigChange()
        const configSub = this.config.changed$?.subscribe(() => {
            syncOnConfigChange()
        })

        const teardown = () => {
            if (configSub && typeof configSub.unsubscribe === 'function') {
                configSub.unsubscribe()
            }
            try {
                barRef.destroy()
            } catch {}
            try {
                this.appRef.detachView(barRef.hostView)
            } catch {}
            if (host.parentNode === sshTabEl) {
                host.parentNode.removeChild(host)
            }
            sshTabEl.removeAttribute('data-ss-attached')
            sshTabEl.classList.remove('server-stats-tab')
        }

        this.tabInstances.set(sshTabEl, { teardown, runPoll, collector, state, configSub })
        this.attachedTabs.add(sshTabEl)
    }

    private detachFromTab(tabEl: HTMLElement) {
        const existing = this.tabInstances.get(tabEl)
        if (existing) {
            logDebug('[state] detachFromTab')
            existing.teardown()
            this.tabInstances.delete(tabEl)
        }
        this.attachedTabs.delete(tabEl)
        this.tabElementMap.delete(tabEl)
    }

    private rebuildTabElementMap() {
        const tabs = this.getAllLeafTabs()
        // Skip the rebuild when the tab set is unchanged AND every tab already
        // resolved to an element. The latter guard ensures we keep retrying for
        // tabs whose DOM element did not exist yet on a previous pass.
        const sameSet = tabs.length === this.cachedLeafTabs.length
            && tabs.every((t, i) => t === this.cachedLeafTabs[i])
        if (sameSet && this.tabElementMap.size === tabs.length) {
            return
        }
        this.cachedLeafTabs = tabs
        this.tabElementMap.clear()
        tabs.forEach(tab => {
            const el = this.getTabElement(tab)
            if (el) {
                this.tabElementMap.set(el, tab)
            }
        })
    }

    private getAllLeafTabs(): any[] {
        const result: any[] = []
        const walk = (tab: any) => {
            if (!tab) return
            if (typeof tab.getAllTabs === 'function') {
                const inner = tab.getAllTabs()
                if (Array.isArray(inner)) {
                    inner.forEach((t: any) => walk(t))
                    return
                }
            }
            result.push(tab)
        }
        if (Array.isArray(this.app.tabs)) {
            this.app.tabs.forEach(tab => walk(tab))
        }
        return result
    }

    private getTabElement(tab: any): HTMLElement | null {
        if (!tab) return null
        const direct = tab.element && tab.element.nativeElement
        if (direct instanceof HTMLElement) {
            return direct
        }
        const hostView = tab.hostView && (tab.hostView as any).rootNodes
        if (hostView && hostView[0] instanceof HTMLElement) {
            return hostView[0]
        }
        const embedded = tab.viewContainerEmbeddedRef && tab.viewContainerEmbeddedRef.rootNodes
        if (embedded && embedded[0] instanceof HTMLElement) {
            return embedded[0]
        }
        return null
    }

    private resolveSessionForElement(el: HTMLElement): any {
        const tab = this.tabElementMap.get(el)
        if (tab) {
            return this.resolveSessionFromTab(tab)
        }
        for (const [knownEl, knownTab] of this.tabElementMap.entries()) {
            if (knownEl && knownEl.contains && knownEl.contains(el)) {
                return this.resolveSessionFromTab(knownTab)
            }
        }
        return null
    }

    private resolveSessionFromTab(tab: any): any {
        if (!tab) return null
        if (tab.session) return tab.session
        if (tab.focusedTab) {
            return this.resolveSessionFromTab(tab.focusedTab)
        }
        return null
    }

    private observeTabLifecycle() {
        this.disposables.forEach(fn => fn())
        this.disposables = []

        const tabRemoved = this.app.tabRemoved$?.subscribe(tab => {
            const el = this.getTabElement(tab)
            if (el) {
                this.detachFromTab(el)
            }
            this.rebuildTabElementMap()
        })
        const tabClosed = this.app.tabClosed$?.subscribe(tab => {
            const el = this.getTabElement(tab)
            if (el) {
                this.detachFromTab(el)
            }
            this.rebuildTabElementMap()
        })
        const tabOpened = this.app.tabOpened$?.subscribe(() => {
            this.rebuildTabElementMap()
            this.attachExistingTabs()
        })
        const tabsChanged = this.app.tabsChanged$?.subscribe(() => {
            this.rebuildTabElementMap()
            this.attachExistingTabs()
        })
        // Poll the newly-active tab immediately on switch so its bar refreshes
        // without waiting for the next central tick.
        const onActiveTabChange = () => {
            if (this.activeDisplayMode === 'bottomBar') {
                // Fire-and-forget immediate refresh of the newly-active tab.
                this.pollActiveTabsOnce()
            }
        }
        const activeTabChange = (this.app as any).activeTabChange$?.subscribe?.(onActiveTabChange)
            || (this.app as any).activeTabChange?.subscribe?.(onActiveTabChange)

        ;[tabRemoved, tabClosed, tabOpened, tabsChanged, activeTabChange].forEach(sub => {
            if (sub && typeof sub.unsubscribe === 'function') {
                this.disposables.push(() => sub.unsubscribe())
            }
        })
    }

    private destroyFloating() {
        if (this.floatingRef) {
            try {
                this.appRef.detachView(this.floatingRef.hostView)
            } catch {}
            this.floatingRef.destroy()
            if (this.floatingElem && this.floatingElem.parentNode) {
                this.floatingElem.parentNode.removeChild(this.floatingElem)
            }
            this.floatingRef = null
            this.floatingElem = null
        }
    }

    private teardownAllTabs() {
        if (this.scanTimer) {
            clearInterval(this.scanTimer)
            this.scanTimer = null
        }
        if (this.pollTimer) {
            clearTimeout(this.pollTimer)
            this.pollTimer = null
        }
        this.pollBackoffMs = 0
        if (this.retryTimer) {
            clearTimeout(this.retryTimer)
            this.retryTimer = null
        }
        this.disposables.forEach(fn => fn())
        this.disposables = []
        this.attachedTabs.forEach(el => {
            const instance = this.tabInstances.get(el)
            if (instance) {
                instance.teardown()
            }
        })
        this.attachedTabs.clear()
        this.tabInstances = new WeakMap()
        this.tabElementMap.clear()
        this.cachedLeafTabs = []
    }
}
