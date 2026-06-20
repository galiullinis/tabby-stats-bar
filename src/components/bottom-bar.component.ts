import { Component, OnInit, OnDestroy, ChangeDetectorRef, NgZone, ViewChild, ElementRef } from '@angular/core'
import { Subscription } from 'rxjs'
import { AppService, ConfigService } from 'tabby-core'
import { StatsService } from '../services/stats.service'
import { CustomMetric } from '../config'
import { formatSpeed, formatBytes, selectCompactMounts, formatMountsTooltip, DiskMount } from '../services/stats-parser'
import { clampPollIntervalMs } from '../services/poll-timing'
import { pushSample, clampSparklineBars, cpuColor } from '../services/sparkline'

@Component({
    selector: 'server-stats-bottom-bar',
    template: `
        <div class="stats-container" 
             *ngIf="visible"
             [style.background]="styleConfig.background">
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
                <div class="stat-separator"></div>

                <ng-container *ngIf="showIoWait">
                    <div class="stat-section">
                        <div class="stat-label" title="{{ 'CPU time waiting on disk I/O' | translate }}">{{ 'IOW' | translate }}</div>
                        <div class="stat-content">
                            <div class="stat-value" [style.color]="ioColorFor(currentStats.iowait)">{{ currentStats.iowait | number:'1.0-0' }}%</div>
                        </div>
                    </div>
                    <div class="stat-separator"></div>
                </ng-container>

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
                <div class="stat-separator"></div>

                <div class="stat-section">
                    <div class="stat-label">{{ 'DISK' | translate }}</div>
                    <div class="stat-content">
                        <ng-container *ngIf="diskStyle === 'mounts' && compactMounts.length; else diskBar">
                            <div class="disk-mounts" [title]="mountsTooltip">
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

                <ng-container *ngFor="let metric of customMetrics; let i = index">
                    <div class="stat-separator"></div>
                    <div class="stat-section">
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

                <div class="stat-separator"></div>

                <div class="stat-section net-section">
                    <div class="stat-label">{{ 'NET' | translate }}</div>
                    <div class="net-container">
                        <div class="net-row download">
                            <span>↓</span> <span class="net-value">{{ formatSpeed(currentStats.netRx) }}</span>
                        </div>
                        <div class="net-row upload">
                            <span>↑</span> <span class="net-value">{{ formatSpeed(currentStats.netTx) }}</span>
                        </div>
                    </div>
                </div>
            </ng-container>
        </div>
    `,
    styles: [`
        :host { display: block; width: 100%; position: relative; box-sizing: border-box; }
        .stats-container {
            position: relative;
            width: 100%;
            box-sizing: border-box;
            backdrop-filter: blur(8px);
            padding: 2px 12px;
            display: flex;
            flex-wrap: wrap;
            gap: 8px 12px;
            justify-content: flex-start;
            align-items: center;
            border-top: 1px solid rgba(255,255,255,0.15);
            color: rgba(255,255,255,0.9);
            user-select: none;
            font-size: 11px;
        }
        .stat-section { display: flex; align-items: center; gap: 6px; flex: 0 0 auto; }
        .stat-label { font-weight: 500; color: rgba(255,255,255,0.7); font-size: 12px; line-height: 1; min-width: 24px; white-space: nowrap; }
        .stat-content { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
        .progress-bar-container { height: 6px; background-color: rgba(255,255,255,0.1); border-radius: 3px; overflow: hidden; width: 60px; }
        .progress-bar { height: 100%; transition: width 0.3s ease, background-color 0.3s ease; border-radius: 3px; }
        .cpu-sparkline { display: block; box-sizing: content-box; background-color: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.25); border-radius: 2px; }
        .cpu-current { min-width: 30px; text-align: right; font-weight: 600; }
        .disk-mounts { display: flex; align-items: center; gap: 5px; flex-wrap: wrap; font-family: monospace; font-size: 12px; line-height: 1.4; }
        .disk-mount-sep { width: 1px; height: 11px; background-color: rgba(255,255,255,0.25); display: inline-block; }
        .disk-mount-name { color: rgba(255,255,255,0.65); }
        .disk-mount-pct { font-weight: 600; margin-left: -2px; }
        .stat-value { font-family: monospace; font-size: 12px; color: rgba(255,255,255,0.9); line-height: 1.4; white-space: nowrap; text-align: left; }
        .stat-separator { width: 1px; min-height: 16px; background-color: rgba(255,255,255,0.2); margin: 0 2px; align-self: center; flex: 0 0 1px; }
        .net-section { min-width: 120px; margin-left: auto; }
        .net-container { display: flex; flex-direction: column; gap: 4px; font-family: monospace; font-size: 10px; align-items: flex-start; }
        .net-row { white-space: nowrap; display: flex; align-items: center; gap: 4px; line-height: 1.2; }
        .net-value { display: inline-block; min-width: 60px; text-align: left; }
        .download { color: #2ecc71; }
        .upload { color: #e74c3c; }
        .loading-text { color: rgba(255,255,255,0.6); font-size: 10px; font-style: italic; }
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
    public compactMounts: DiskMount[] = []
    public mountsTooltip = ''
    // First-class I/O wait %, computed in the core from /proc/stat delta. Optional.
    public showIoWait = false
    @ViewChild('cpuSparkline') private cpuCanvas?: ElementRef<HTMLCanvasElement>
    public cpuHistory: number[] = []
    public sparklineBars = 40          // configurable, clamped 20..60
    public readonly sparklinePitch = 2 // px per bar (1px bar + 1px gap)
    public readonly sparklineHeight = 16

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
    }

    setExternalLoading(isLoading: boolean) {
        this.visible = true;
        this.loading = isLoading;
        this.cdr.detectChanges();
    }

    hideExternal() {
        this.visible = false;
        this.loading = true;
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
        this.showIoWait = !!conf.showIoWait;
        this.sparklineBars = clampSparklineBars(conf.sparklineBars);
        // Keep history within the (possibly reduced) bar count.
        if (this.cpuHistory.length > this.sparklineBars) {
            this.cpuHistory = this.cpuHistory.slice(this.cpuHistory.length - this.sparklineBars);
        }
        this.cdr.detectChanges();
        this.drawSparkline();
    }

    formatSpeed(bytes: number): string {
        return formatSpeed(bytes);
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
        this.compactMounts = selectCompactMounts(mounts)
        this.mountsTooltip = formatMountsTooltip(mounts)
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
        if (this.tabSubscription) this.tabSubscription.unsubscribe()
        this.configSubscriptions.forEach(sub => sub.unsubscribe())
    }
}
