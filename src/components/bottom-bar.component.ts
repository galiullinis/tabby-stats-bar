import { Component, OnInit, OnDestroy, ChangeDetectorRef, NgZone, ViewChild, ElementRef } from '@angular/core'
import { Subscription } from 'rxjs'
import { AppService, ConfigService } from 'tabby-core'
import { StatsService } from '../services/stats.service'
import { CustomMetric } from '../config'
import { formatSpeed, formatBytes, selectCompactMounts, DiskMount } from '../services/stats-parser'
import { clampPollIntervalMs } from '../services/poll-timing'
import { pushSample, clampSparklineBars, cpuColor } from '../services/sparkline'
import { buildExtraMetrics, extraMetricsFor, ExtraMetric } from '../services/extra-metrics'

@Component({
    selector: 'server-stats-bottom-bar',
    template: `
        <div class="stats-outer"
             *ngIf="visible"
             [style.background]="styleConfig.background">

            <button type="button" class="scroll-btn" *ngIf="overflowing"
                    [disabled]="!canScrollLeft"
                    (click)="scrollStep(-1)"
                    title="{{ 'Scroll left' | translate }}">‹</button>

            <div class="stats-container" #scroller
                 [class.wrap]="overflowMode === 'wrap'"
                 (scroll)="onScrollerScroll()"
                 (wheel)="onWheel($event)">
                <div class="stat-section" *ngIf="loading">
                    <div class="loading-text">Loading...</div>
                </div>

                <ng-container *ngIf="!loading">
                    <div class="stat-section">
                        <div class="stat-label">{{ 'CPU' | translate }}</div>
                        <div class="stat-content">
                            <ng-container *ngIf="cpuStyle === 'sparkline'; else cpuBar">
                                <canvas #cpuSparkline class="cpu-sparkline"
                                        [style.width.px]="sparklineBars * sparklinePitch"
                                        [style.height.px]="sparklineHeight"></canvas>
                                <div class="stat-value cpu-current" [style.color]="getCpuColor()">{{currentStats.cpu | number:'1.0-0'}}%</div>
                            </ng-container>
                            <ng-template #cpuBar>
                                <div class="progress-bar-container">
                                    <div class="progress-bar" [style.width.%]="currentStats.cpu" [style.background-color]="getCpuColor()"></div>
                                </div>
                                <div class="stat-value">{{currentStats.cpu | number:'1.0-0'}}%</div>
                            </ng-template>
                        </div>
                    </div>

                    <div class="stat-section" *ngIf="showIoWait">
                        <div class="stat-label" title="{{ 'CPU time waiting on disk I/O' | translate }}">{{ 'IOW' | translate }}</div>
                        <div class="stat-content">
                            <div class="stat-value" [style.color]="ioColorFor(currentStats.iowait)">{{ currentStats.iowait | number:'1.0-0' }}%</div>
                        </div>
                    </div>

                    <div class="stat-section">
                        <div class="stat-label">{{ 'RAM' | translate }}</div>
                        <div class="stat-content">
                            <ng-container *ngIf="ramStyle === 'text'; else ramBar">
                                <div class="stat-value" [style.color]="getMemColor()">{{ getRamText() }}</div>
                            </ng-container>
                            <ng-template #ramBar>
                                <div class="progress-bar-container">
                                    <div class="progress-bar" [style.width.%]="currentStats.mem" [style.background-color]="getMemColor()"></div>
                                </div>
                                <div class="stat-value">{{currentStats.mem | number:'1.0-0'}}%</div>
                            </ng-template>
                        </div>
                    </div>

                    <div class="stat-section">
                        <div class="stat-label">{{ 'NET' | translate }}</div>
                        <div class="net-container" [class.inline]="netStyle === 'inline'">
                            <div class="net-row download">
                                <span class="net-arrow">↓</span><span class="net-value">{{ formatSpeed(currentStats.netRx) }}</span>
                            </div>
                            <div class="net-row upload">
                                <span class="net-arrow">↑</span><span class="net-value">{{ formatSpeed(currentStats.netTx) }}</span>
                            </div>
                        </div>
                    </div>

                    <div class="stat-section" *ngFor="let extra of extrasAfterNet">
                        <div class="stat-label" title="{{ extra.title | translate }}">{{ extra.label | translate }}</div>
                        <div class="stat-content">
                            <div class="stat-value" [style.color]="extra.color">{{ extra.value }}</div>
                        </div>
                    </div>

                    <div class="stat-section">
                        <div class="stat-label">{{ 'DISK' | translate }}</div>
                        <div class="stat-content">
                            <ng-container *ngIf="diskStyle === 'mounts' && compactMounts.length; else diskBar">
                                <div class="disk-mounts"
                                     (mouseenter)="onMountsEnter($event)"
                                     (mouseleave)="onMountsLeave()">
                                    <ng-container *ngFor="let mnt of compactMounts; let i = index">
                                        <span class="disk-mount-sep" *ngIf="i > 0"></span>
                                        <span class="disk-mount-name">{{ mnt.mount }}</span>
                                        <span class="disk-mount-pct" [style.color]="diskColorFor(mnt.usagePercent)">{{ mnt.usagePercent }}%</span>
                                    </ng-container>
                                </div>
                            </ng-container>
                            <ng-template #diskBar>
                                <div class="progress-bar-container">
                                    <div class="progress-bar" [style.width.%]="currentStats.disk" [style.background-color]="getDiskColor()"></div>
                                </div>
                                <div class="stat-value">{{currentStats.disk | number:'1.0-0'}}%</div>
                            </ng-template>
                        </div>
                    </div>

                    <div class="stat-section" *ngFor="let extra of extrasAfterDisk">
                        <div class="stat-label" title="{{ extra.title | translate }}">{{ extra.label | translate }}</div>
                        <div class="stat-content">
                            <div class="stat-value" [style.color]="extra.color">{{ extra.value }}</div>
                        </div>
                    </div>

                    <div class="stat-section" *ngFor="let metric of customMetrics; let i = index">
                        <div class="stat-label">{{ metric.label }}</div>

                        <div class="stat-content" *ngIf="metric.type === 'progress'">
                            <div class="progress-bar-container">
                                <div class="progress-bar"
                                     [style.width.%]="getCustomProgress(i)"
                                     [style.background-color]="metric.color || '#3498db'"></div>
                            </div>
                            <div class="stat-value">{{ getCustomValue(i) }}</div>
                        </div>

                        <div class="stat-content" *ngIf="metric.type === 'text'">
                            <div class="stat-value" [style.color]="metric.color || 'inherit'">
                                {{ getCustomValue(i) }} {{ metric.suffix }}
                            </div>
                        </div>
                    </div>
                </ng-container>
            </div>

            <button type="button" class="scroll-btn" *ngIf="overflowing"
                    [disabled]="!canScrollRight"
                    (click)="scrollStep(1)"
                    title="{{ 'Scroll right' | translate }}">›</button>
        </div>

        <!-- Mount tooltip. Rendered OUTSIDE .stats-outer on purpose: the scroll
             container clips its children, and .stats-outer's backdrop-filter makes
             it the containing block for position:fixed descendants. -->
        <div class="mounts-tooltip" *ngIf="tooltipVisible"
             [style.left.px]="tooltipPos.x"
             [style.bottom.px]="tooltipPos.y">
            <div class="mt-title">{{ 'Mount points' | translate }}</div>
            <div class="mt-row" *ngFor="let mnt of allMounts">
                <span class="mt-name">{{ mnt.mount }}</span>
                <span class="mt-pct" [style.color]="diskColorFor(mnt.usagePercent)">{{ mnt.usagePercent }}%</span>
                <span class="mt-size">{{ formatBytes(mnt.usedBytes) }} / {{ formatBytes(mnt.totalBytes) }}</span>
            </div>
        </div>
    `,
    styles: [`
        :host { display: block; width: 100%; position: relative; box-sizing: border-box; }
        .stats-outer {
            position: relative;
            width: 100%;
            box-sizing: border-box;
            display: flex;
            align-items: stretch;
            backdrop-filter: blur(8px);
            border-top: 1px solid rgba(255,255,255,0.15);
            color: rgba(255,255,255,0.9);
            user-select: none;
            font-size: 11px;
        }
        .stats-container {
            flex: 1 1 auto;
            min-width: 0;
            box-sizing: border-box;
            padding: 2px 12px;
            display: flex;
            flex-wrap: nowrap;
            overflow-x: auto;
            overflow-y: hidden;
            gap: 8px 10px;
            justify-content: flex-start;
            align-items: center;
            scrollbar-width: none;
        }
        .stats-container.wrap { flex-wrap: wrap; overflow-x: hidden; }
        .stats-container::-webkit-scrollbar { height: 0; width: 0; }
        /* Divider between adjacent sections — replaces the old explicit
           separator elements, so optional sections need no separator logic. */
        .stat-section + .stat-section { border-left: 1px solid rgba(255,255,255,0.2); padding-left: 10px; }
        .scroll-btn {
            flex: 0 0 auto;
            width: 18px;
            padding: 0;
            border: none;
            border-left: 1px solid rgba(255,255,255,0.12);
            border-right: 1px solid rgba(255,255,255,0.12);
            background: rgba(255,255,255,0.06);
            color: rgba(255,255,255,0.85);
            font-size: 15px;
            line-height: 1;
            cursor: pointer;
        }
        .scroll-btn:hover:not(:disabled) { background: rgba(255,255,255,0.16); }
        .scroll-btn:disabled { opacity: 0.25; cursor: default; }
        .stat-section { display: flex; align-items: center; gap: 6px; flex: 0 0 auto; }
        .stat-label { font-weight: 500; color: rgba(255,255,255,0.7); font-size: 12px; line-height: 1; white-space: nowrap; }
        .stat-content { display: flex; align-items: center; gap: 6px; }
        .progress-bar-container { height: 6px; background-color: rgba(255,255,255,0.1); border-radius: 3px; overflow: hidden; width: 60px; }
        .progress-bar { height: 100%; transition: width 0.3s ease, background-color 0.3s ease; border-radius: 3px; }
        .cpu-sparkline { display: block; box-sizing: content-box; background-color: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.25); border-radius: 2px; }
        .cpu-current { min-width: 30px; text-align: right; font-weight: 600; }
        .disk-mounts { display: flex; align-items: center; gap: 5px; font-family: monospace; font-size: 12px; line-height: 1.4; cursor: default; }
        .disk-mount-sep { width: 1px; height: 11px; background-color: rgba(255,255,255,0.25); display: inline-block; }
        .disk-mount-name { color: rgba(255,255,255,0.65); }
        .disk-mount-pct { font-weight: 600; margin-left: -2px; }
        .stat-value { font-family: monospace; font-size: 12px; color: rgba(255,255,255,0.9); line-height: 1.4; white-space: nowrap; text-align: left; }
        .net-container { display: flex; flex-direction: column; gap: 4px; font-family: monospace; font-size: 10px; align-items: flex-start; }
        .net-container.inline { flex-direction: row; align-items: center; gap: 8px; font-size: 12px; }
        .net-row { white-space: nowrap; display: flex; align-items: center; gap: 4px; line-height: 1.2; }
        .net-arrow { display: inline-block; }
        .net-value { display: inline-block; min-width: 58px; text-align: left; }
        .net-container.inline .net-value { min-width: 62px; }
        .download { color: #2ecc71; }
        .upload { color: #e74c3c; }
        .loading-text { color: rgba(255,255,255,0.6); font-size: 10px; font-style: italic; }
        .mounts-tooltip {
            position: fixed;
            z-index: 100000;
            min-width: 220px;
            max-width: 300px;
            max-height: 50vh;
            overflow-y: auto;
            padding: 6px 8px;
            border-radius: 5px;
            border: 1px solid rgba(255,255,255,0.18);
            background: rgba(24,24,24,0.97);
            box-shadow: 0 6px 20px rgba(0,0,0,0.5);
            color: rgba(255,255,255,0.9);
            font-family: monospace;
            font-size: 11px;
            line-height: 1.5;
            pointer-events: none;
        }
        .mt-title { font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em; color: rgba(255,255,255,0.5); margin-bottom: 3px; }
        .mt-row { display: grid; grid-template-columns: 1fr auto auto; gap: 10px; white-space: nowrap; }
        .mt-name { overflow: hidden; text-overflow: ellipsis; }
        .mt-pct { font-weight: 600; text-align: right; }
        .mt-size { color: rgba(255,255,255,0.6); text-align: right; }
    `]
})
export class ServerStatsBottomBarComponent implements OnInit, OnDestroy {
    visible = false
    loading = true
    currentStats: any = { cpu: 0, iowait: 0, mem: 0, disk: 0, netRx: 0, netTx: 0, custom: [] }
    customMetrics: CustomMetric[] = []

    public styleConfig = { background: 'rgba(20, 20, 20, 0.85)' }
    private timerId: any = null
    private tabSubscription: Subscription | null = null
    private configSubscriptions: Subscription[] = []
    private boundSession: any = null
    public useExternalController = false

    // CPU display: 'bar' (classic progress bar) or 'sparkline' (MobaXterm-like
    // history). Configurable; defaults to 'bar' to preserve existing behaviour.
    public cpuStyle: 'bar' | 'sparkline' = 'bar'
    // RAM display: 'bar' (progress bar + %) or 'text' (used / total). Default 'bar'.
    public ramStyle: 'bar' | 'text' = 'bar'
    // Disk display: 'single' (root % progress bar) or 'mounts' (per-mount). Default 'single'.
    public diskStyle: 'single' | 'mounts' = 'single'
    // NET display: 'stacked' (↓ over ↑) or 'inline' (both on one row). Default 'stacked'.
    public netStyle: 'stacked' | 'inline' = 'stacked'
    public compactMounts: DiskMount[] = []
    public allMounts: DiskMount[] = []
    // First-class I/O wait %, computed in the core from /proc/stat delta. Optional.
    public showIoWait = false
    // Uptime / load / users / SSH sessions — optional single-value metrics.
    // Uptime sits right after NET; the rest follow DISK.
    public extrasAfterNet: ExtraMetric[] = []
    public extrasAfterDisk: ExtraMetric[] = []
    @ViewChild('cpuSparkline') private cpuCanvas?: ElementRef<HTMLCanvasElement>
    public cpuHistory: number[] = []
    public sparklineBars = 40          // configurable, clamped 20..60
    public readonly sparklinePitch = 2 // px per bar (1px bar + 1px gap)
    public readonly sparklineHeight = 16

    // ── Overflow handling ───────────────────────────────────────────────────
    // 'scroll' keeps the bar one row tall and exposes ‹ › buttons (plus wheel
    // scrolling) once the metrics stop fitting; 'wrap' is the old behaviour of
    // growing taller, which eats terminal rows.
    public overflowMode: 'scroll' | 'wrap' = 'scroll'
    public overflowing = false
    public canScrollLeft = false
    public canScrollRight = false
    @ViewChild('scroller') private scrollerRef?: ElementRef<HTMLDivElement>
    private resizeObserver: any = null
    private observedScroller: HTMLElement | null = null
    private scrollStateTimer: any = null

    // ── Mount tooltip ───────────────────────────────────────────────────────
    // Own tooltip instead of the native `title`: `title` has a ~1s browser delay
    // we cannot tune and truncates long text. This one lists every mount.
    public static readonly TOOLTIP_DELAY_MS = 500
    public tooltipVisible = false
    public tooltipPos = { x: 0, y: 0 }
    private tooltipTimer: any = null

    constructor(
        private statsService: StatsService,
        private config: ConfigService,
        private app: AppService,
        private cdr: ChangeDetectorRef,
        private zone: NgZone
    ) {
    }

    getCpuColor(): string {
        const cpu = this.currentStats.cpu;
        if (cpu < 50) return '#2ecc71';
        if (cpu < 80) return '#f1c40f';
        return '#e74c3c';
    }

    getMemColor(): string {
        const mem = this.currentStats.mem;
        if (mem < 50) return '#2ecc71';
        if (mem < 80) return '#f1c40f';
        return '#e74c3c';
    }

    // "3.2G/8G" when absolute values are known, otherwise falls back to "NN%".
    getRamText(): string {
        const total = this.currentStats.memTotal;
        if (total && total > 0) {
            return `${formatBytes(this.currentStats.memUsed || 0)}/${formatBytes(total)}`;
        }
        return `${Math.round(this.currentStats.mem || 0)}%`;
    }

    getDiskColor(): string {
        return this.diskColorFor(this.currentStats.disk);
    }

    diskColorFor(pct: number): string {
        if (pct < 50) return '#2ecc71';
        if (pct < 80) return '#3498db';
        return '#e74c3c';
    }

    ioColorFor(pct: number): string {
        if (pct < 10) return '#2ecc71';
        if (pct < 30) return '#f1c40f';
        return '#e74c3c';
    }

    bindToSession(session: any) {
        this.boundSession = session;
        this.visible = true;
        this.loading = true;
    }

    renderExternalStats(stats: any | null) {
        this.visible = true;
        if (stats) {
            this.visible = true;
            this.loading = false;
            this.updateStats(stats);
            this.currentStats = stats;
        } else {
            this.loading = false;
        }
        this.cdr.detectChanges();
        this.drawSparkline();
        this.scheduleScrollStateUpdate();
    }

    setExternalLoading(isLoading: boolean) {
        this.visible = true;
        this.loading = isLoading;
        this.cdr.detectChanges();
    }

    hideExternal() {
        this.visible = false;
        this.loading = true;
        this.hideMountsTooltip();
        this.cdr.detectChanges();
    }

    // 获取自定义指标的值
    getCustomValue(index: number): string {
        if (!this.currentStats.custom || !this.currentStats.custom[index]) return '-';
        return this.currentStats.custom[index].value;
    }

    // 获取自定义进度条的百分比
    getCustomProgress(index: number): number {
        const valStr = this.getCustomValue(index);
        const val = parseFloat(valStr);
        if (isNaN(val)) return 0;

        const metric = this.customMetrics[index];
        const max = metric.maxValue || 100;
        return Math.min(100, Math.max(0, (val / max) * 100));
    }

    private resolveSession(): any {
        if (this.boundSession) {
            return this.boundSession;
        }

        let activeTab: any = this.app.activeTab;
        if (!activeTab) {
            return null;
        }

        if (activeTab['focusedTab']) {
            activeTab = activeTab['focusedTab'];
        }

        return activeTab['session'] || null;
    }

    ngOnInit() {
        this.loadConfig();
        this.configSubscriptions.push(this.config.ready$.subscribe(() => {
            this.loadConfig();
            setTimeout(() => this.checkAndFetch(), 100);
        }));
        this.configSubscriptions.push(this.config.changed$.subscribe(() => this.loadConfig()));

        if (this.useExternalController) {
            return;
        }

        if (!this.boundSession && (this.app as any).activeTabChange) {
            this.tabSubscription = (this.app as any).activeTabChange.subscribe(() => {
                this.checkAndFetch();
            });
        }
        setTimeout(() => this.checkAndFetch(), 100);
        this.zone.runOutsideAngular(() => {
            this.timerId = window.setInterval(() => {
                this.zone.run(() => { this.checkAndFetch() })
            }, clampPollIntervalMs(this.config.store?.plugin?.serverStats?.pollInterval))
        })
    }

    loadConfig() {
        const conf = this.config.store.plugin?.serverStats || {};
        if (conf.style) {
            this.styleConfig = { ...this.styleConfig, ...conf.style };
        }
        // 加载自定义指标配置
        this.customMetrics = conf.customMetrics || [];
        this.cpuStyle = conf.cpuStyle === 'sparkline' ? 'sparkline' : 'bar';
        this.ramStyle = conf.ramStyle === 'text' ? 'text' : 'bar';
        this.diskStyle = conf.diskStyle === 'mounts' ? 'mounts' : 'single';
        this.netStyle = conf.netStyle === 'inline' ? 'inline' : 'stacked';
        this.overflowMode = conf.overflowMode === 'wrap' ? 'wrap' : 'scroll';
        this.showIoWait = !!conf.showIoWait;
        this.sparklineBars = clampSparklineBars(conf.sparklineBars);
        // Keep history within the (possibly reduced) bar count.
        if (this.cpuHistory.length > this.sparklineBars) {
            this.cpuHistory = this.cpuHistory.slice(this.cpuHistory.length - this.sparklineBars);
        }
        this.rebuildExtraMetrics();
        this.cdr.detectChanges();
        this.drawSparkline();
        this.scheduleScrollStateUpdate();
    }

    formatSpeed(bytes: number): string {
        return formatSpeed(bytes);
    }

    formatBytes(bytes: number): string {
        return formatBytes(bytes);
    }

    async checkAndFetch() {
        if (this.useExternalController) {
            return;
        }

        const isEnabled = this.config.store.plugin?.serverStats?.enabled;
        const displayMode = this.config.store.plugin?.serverStats?.displayMode || 'bottomBar';

        if (displayMode !== 'bottomBar') {
            if (this.visible) {
                this.visible = false;
                this.loading = true;
                this.cdr.detectChanges();
            }
            return;
        }

        const session = this.resolveSession();

        if (!isEnabled || !session) {
            if (this.visible) {
                this.visible = false;
                this.loading = true;
                this.cdr.detectChanges();
            }
            return;
        }

        if (session && this.statsService.isPlatformSupport(session)) {
            if (!this.visible) {
                this.visible = true;
                this.loading = true;
                this.cdr.detectChanges();
            }

            try {
                const data = await this.statsService.fetchStats(session)
                this.loading = false;
                if (data) {
                    this.updateStats(data);
                    this.currentStats = data;
                }
                this.cdr.detectChanges();
                this.drawSparkline();
                this.scheduleScrollStateUpdate();
            } catch (e) {
                this.loading = false;
                this.cdr.detectChanges();
            }
        } else {
            if (this.visible) {
                this.visible = false;
                this.loading = true;
                this.cdr.detectChanges();
            }
        }
    }

    updateStats(stats: { cpu: number, mem: number, disk: number, netRx: number, netTx: number }) {
        this.currentStats = stats
        this.cpuHistory = pushSample(this.cpuHistory, stats.cpu, this.sparklineBars)
        const mounts = (stats as any).mounts as DiskMount[] | undefined
        this.allMounts = mounts || []
        this.compactMounts = selectCompactMounts(mounts)
        this.rebuildExtraMetrics()
    }

    // Optional single-value metrics, in a fixed order. Rebuilt on every sample so
    // the template stays free of per-metric branches.
    private rebuildExtraMetrics() {
        const extras = buildExtraMetrics(this.config.store.plugin?.serverStats, this.currentStats)
        this.extrasAfterNet = extraMetricsFor('afterNet', extras)
        this.extrasAfterDisk = extraMetricsFor('afterDisk', extras)
    }

    // ── Overflow / scrolling ────────────────────────────────────────────────

    onScrollerScroll() {
        this.hideMountsTooltip()
        this.updateScrollState()
    }

    onWheel(event: WheelEvent) {
        if (this.overflowMode !== 'scroll') {
            return
        }
        const el = this.scrollerRef?.nativeElement
        if (!el || el.scrollWidth - el.clientWidth <= 1) {
            return
        }
        const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY
        if (!delta) {
            return
        }
        el.scrollLeft += delta
        event.preventDefault()
        this.updateScrollState()
    }

    scrollStep(direction: number) {
        const el = this.scrollerRef?.nativeElement
        if (!el) {
            return
        }
        const step = Math.max(80, Math.round(el.clientWidth * 0.6)) * direction
        if (typeof el.scrollBy === 'function') {
            el.scrollBy({ left: step, behavior: 'smooth' })
        } else {
            el.scrollLeft += step
        }
        this.scheduleScrollStateUpdate()
    }

    private scheduleScrollStateUpdate() {
        if (this.scrollStateTimer) {
            return
        }
        this.scrollStateTimer = setTimeout(() => {
            this.scrollStateTimer = null
            this.updateScrollState()
        }, 0)
    }

    private updateScrollState() {
        const el = this.scrollerRef?.nativeElement
        if (!el) {
            if (this.overflowing) {
                this.overflowing = false
                this.cdr.detectChanges()
            }
            return
        }
        this.ensureResizeObserver(el)
        const overflowing = this.overflowMode === 'scroll' && el.scrollWidth - el.clientWidth > 1
        const canLeft = overflowing && el.scrollLeft > 1
        const canRight = overflowing && el.scrollLeft + el.clientWidth < el.scrollWidth - 1
        if (overflowing === this.overflowing && canLeft === this.canScrollLeft && canRight === this.canScrollRight) {
            return
        }
        this.overflowing = overflowing
        this.canScrollLeft = canLeft
        this.canScrollRight = canRight
        this.cdr.detectChanges()
    }

    private ensureResizeObserver(el: HTMLElement) {
        const Observer = (window as any).ResizeObserver
        if (!Observer || this.observedScroller === el) {
            return
        }
        this.zone.runOutsideAngular(() => {
            if (this.resizeObserver) {
                try { this.resizeObserver.disconnect() } catch { /* ignore */ }
            }
            this.resizeObserver = new Observer(() => this.scheduleScrollStateUpdate())
            this.resizeObserver.observe(el)
            this.observedScroller = el
        })
    }

    // ── Mount tooltip ───────────────────────────────────────────────────────

    onMountsEnter(event: MouseEvent) {
        const target = event.currentTarget as HTMLElement
        if (!target || !this.allMounts.length) {
            return
        }
        this.clearTooltipTimer()
        this.tooltipTimer = setTimeout(() => {
            this.tooltipTimer = null
            const rect = target.getBoundingClientRect()
            const maxWidth = 300
            this.tooltipPos = {
                x: Math.max(8, Math.min(rect.left, window.innerWidth - maxWidth - 8)),
                // `bottom`, measured from the viewport bottom: the bar lives at the
                // bottom of the tab, so the tooltip always opens upwards.
                y: Math.max(8, window.innerHeight - rect.top + 6),
            }
            this.tooltipVisible = true
            this.cdr.detectChanges()
        }, ServerStatsBottomBarComponent.TOOLTIP_DELAY_MS)
    }

    onMountsLeave() {
        this.hideMountsTooltip()
    }

    private hideMountsTooltip() {
        this.clearTooltipTimer()
        if (this.tooltipVisible) {
            this.tooltipVisible = false
            this.cdr.detectChanges()
        }
    }

    private clearTooltipTimer() {
        if (this.tooltipTimer) {
            clearTimeout(this.tooltipTimer)
            this.tooltipTimer = null
        }
    }

    // Draw the CPU history as thin vertical bars on the canvas. Newest sample is
    // at the right edge; older samples shift left. Uses devicePixelRatio for
    // crisp rendering. A single canvas avoids per-bar DOM churn.
    private drawSparkline() {
        if (this.cpuStyle !== 'sparkline') {
            return
        }
        const canvas = this.cpuCanvas?.nativeElement
        if (!canvas) {
            return
        }
        const cssW = this.sparklineBars * this.sparklinePitch
        const cssH = this.sparklineHeight
        const dpr = window.devicePixelRatio || 1
        const pxW = Math.round(cssW * dpr)
        const pxH = Math.round(cssH * dpr)
        if (canvas.width !== pxW || canvas.height !== pxH) {
            canvas.width = pxW
            canvas.height = pxH
        }
        const ctx = canvas.getContext('2d')
        if (!ctx) {
            return
        }
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
        ctx.clearRect(0, 0, cssW, cssH)

        const barW = this.sparklinePitch - 1
        const n = this.cpuHistory.length
        for (let i = 0; i < n; i++) {
            const v = this.cpuHistory[i]
            const h = Math.max(1, (v / 100) * cssH)
            // Right-align: the last (newest) sample sits at the right edge.
            const x = cssW - (n - i) * this.sparklinePitch
            ctx.fillStyle = cpuColor(v)
            ctx.fillRect(x, cssH - h, barW, h)
        }
    }

    ngOnDestroy() {
        if (this.timerId) clearInterval(this.timerId)
        if (this.scrollStateTimer) clearTimeout(this.scrollStateTimer)
        this.clearTooltipTimer()
        if (this.resizeObserver) {
            try { this.resizeObserver.disconnect() } catch { /* ignore */ }
            this.resizeObserver = null
            this.observedScroller = null
        }
        if (this.tabSubscription) this.tabSubscription.unsubscribe()
        this.configSubscriptions.forEach(sub => sub.unsubscribe())
    }
}
