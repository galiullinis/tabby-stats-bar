import { Component, Injectable } from '@angular/core'
import { ConfigService, TranslateService } from 'tabby-core'
import { SettingsTabProvider } from 'tabby-settings'
import { CustomMetric } from '../config'
import { groupedBuiltinPresets } from '../builtin-presets'
import { clampSparklineBars } from '../services/sparkline'

@Component({
    template: `
        <h3 translate>Server Stats</h3>
        
        <!-- 显示模式选择 -->
        <div class="form-line">
            <div class="header">
                <div class="title" translate>Display Mode</div>
                <div class="description" translate>Choose between floating panel or bottom bar</div>
            </div>
            <div class="btn-group">
                <input type="radio" class="btn-check" name="displayMode" id="displayModeFloating" 
                    autocomplete="off" value="floatingPanel"
                    [(ngModel)]="config.store.plugin.serverStats.displayMode" 
                    (ngModelChange)="save()">
                <label class="btn btn-secondary" for="displayModeFloating" translate>Floating Panel</label>
                <input type="radio" class="btn-check" name="displayMode" id="displayModeBottom" 
                    autocomplete="off" value="bottomBar"
                    [(ngModel)]="config.store.plugin.serverStats.displayMode" 
                    (ngModelChange)="save()">
                <label class="btn btn-secondary" for="displayModeBottom" translate>Bottom Bar</label>
            </div>
        </div>

        <!-- 样式配置 -->
        <div class="form-line">
            <div class="header">
                <div class="title" translate>Background Color</div>
                <div class="description" translate>Background color and opacity</div>
            </div>
            <div class="d-flex align-items-center">
                <input type="color" class="form-control form-control-color me-3" 
                    style="width: 60px;"
                    [ngModel]="hexColor" 
                    (ngModelChange)="setHexColor($event)">
                <span class="text-muted me-2" translate>Opacity</span>
                <input type="range" class="form-range me-2" style="width: 100px" min="0" max="1" step="0.01"
                    [ngModel]="opacity" 
                    (ngModelChange)="setOpacity($event)">
            </div>
        </div>

        <!-- 刷新间隔 -->
        <div class="form-line">
            <div class="header">
                <div class="title" translate>Refresh Interval</div>
                <div class="description" translate>How often stats are fetched (seconds). Only the active tab is polled. Minimum 1s.</div>
            </div>
            <div class="d-flex align-items-center">
                <input type="number" class="form-control" style="width: 90px;" min="1" max="60" step="1"
                    [(ngModel)]="config.store.plugin.serverStats.pollInterval"
                    (ngModelChange)="onIntervalChange($event)">
                <span class="text-muted ms-2" translate>seconds</span>
            </div>
        </div>

        <!-- CPU 显示样式 -->
        <div class="form-line">
            <div class="header">
                <div class="title" translate>CPU Display</div>
                <div class="description" translate>Classic progress bar or a MobaXterm-like history sparkline (bottom bar only).</div>
            </div>
            <div class="btn-group">
                <input type="radio" class="btn-check" name="cpuStyle" id="cpuStyleBar"
                    autocomplete="off" value="bar"
                    [(ngModel)]="config.store.plugin.serverStats.cpuStyle"
                    (ngModelChange)="save()">
                <label class="btn btn-secondary" for="cpuStyleBar" translate>Progress Bar</label>
                <input type="radio" class="btn-check" name="cpuStyle" id="cpuStyleSparkline"
                    autocomplete="off" value="sparkline"
                    [(ngModel)]="config.store.plugin.serverStats.cpuStyle"
                    (ngModelChange)="save()">
                <label class="btn btn-secondary" for="cpuStyleSparkline" translate>Sparkline</label>
            </div>
        </div>

        <!-- Sparkline 列数 -->
        <div class="form-line" *ngIf="config.store.plugin.serverStats.cpuStyle === 'sparkline'">
            <div class="header">
                <div class="title" translate>Sparkline Bars</div>
                <div class="description" translate>Number of CPU history bars shown (20–60).</div>
            </div>
            <div class="d-flex align-items-center">
                <input type="number" class="form-control" style="width: 90px;" min="20" max="60" step="1"
                    [(ngModel)]="config.store.plugin.serverStats.sparklineBars"
                    (ngModelChange)="onSparklineBarsChange($event)">
                <span class="text-muted ms-2" translate>bars</span>
            </div>
        </div>

        <!-- RAM 显示样式 -->
        <div class="form-line">
            <div class="header">
                <div class="title" translate>RAM Display</div>
                <div class="description" translate>Percentage (as now) or numeric used / total, e.g. 3.2G/8G.</div>
            </div>
            <div class="btn-group">
                <input type="radio" class="btn-check" name="ramStyle" id="ramStyleBar"
                    autocomplete="off" value="bar"
                    [(ngModel)]="config.store.plugin.serverStats.ramStyle"
                    (ngModelChange)="save()">
                <label class="btn btn-secondary" for="ramStyleBar" translate>Percentage</label>
                <input type="radio" class="btn-check" name="ramStyle" id="ramStyleText"
                    autocomplete="off" value="text"
                    [(ngModel)]="config.store.plugin.serverStats.ramStyle"
                    (ngModelChange)="save()">
                <label class="btn btn-secondary" for="ramStyleText" translate>Used / Total</label>
            </div>
        </div>

        <!-- Disk 显示样式 -->
        <div class="form-line">
            <div class="header">
                <div class="title" translate>Disk Display</div>
                <div class="description" translate>Root only, or per mount point (shows / plus the fullest local mounts; full list on hover). Bottom bar only.</div>
            </div>
            <div class="btn-group">
                <input type="radio" class="btn-check" name="diskStyle" id="diskStyleSingle"
                    autocomplete="off" value="single"
                    [(ngModel)]="config.store.plugin.serverStats.diskStyle"
                    (ngModelChange)="save()">
                <label class="btn btn-secondary" for="diskStyleSingle" translate>Root (/)</label>
                <input type="radio" class="btn-check" name="diskStyle" id="diskStyleMounts"
                    autocomplete="off" value="mounts"
                    [(ngModel)]="config.store.plugin.serverStats.diskStyle"
                    (ngModelChange)="save()">
                <label class="btn btn-secondary" for="diskStyleMounts" translate>Mount Points</label>
            </div>
        </div>

        <!-- I/O Wait 开关 -->
        <div class="form-line">
            <div class="header">
                <div class="title" translate>Show I/O Wait</div>
                <div class="description" translate>CPU time spent waiting on disk I/O (Linux). Computed from /proc/stat — no extra command.</div>
            </div>
            <div class="form-check form-switch">
                <input type="checkbox" class="form-check-input"
                    [(ngModel)]="config.store.plugin.serverStats.showIoWait"
                    (ngModelChange)="save()">
            </div>
        </div>

        <!-- 调试日志开关 -->
        <div class="form-line">
            <div class="header">
                <div class="title" translate>Debug Logging</div>
                <div class="description" translate>Write diagnostic logs to a temp file. Off by default; enable only when troubleshooting.</div>
            </div>
            <div class="form-check form-switch">
                <input type="checkbox" class="form-check-input"
                    [(ngModel)]="config.store.plugin.serverStats.debug"
                    (ngModelChange)="save()">
            </div>
        </div>

        <div class="separator"></div>

        <!-- 安全警告 -->
        <div class="alert alert-warning d-flex align-items-start" role="alert">
            <i class="fas fa-exclamation-triangle me-2 mt-1"></i>
            <div translate>
                Custom metrics and presets are shell commands. They are executed on every refresh on the active session — on your local machine or on the remote SSH host. Only add commands you fully trust.
            </div>
        </div>

        <!-- 内置预设区域（仅随插件一起提供，不从网络加载） -->
        <div class="mt-4 mb-3">
            <h4 class="mb-0" translate>Built-in Presets</h4>
            <div class="text-muted" style="font-size: 13px;" translate>
                Ready-made metrics bundled with the plugin. Review each command before adding it.
            </div>

            <!-- 预设列表（按分类分组，便于扩展） -->
            <div style="overflow-x: auto; width: 100%;">
                <ng-container *ngFor="let group of presetGroups">
                    <div class="preset-category-title text-muted mt-3 mb-1">{{ group.category | translate }}</div>
                    <div class="list-group mb-2" style="min-width: 450px">
                        <div class="list-group-item d-flex align-items-center justify-content-between" *ngFor="let p of group.presets">
                            <div class="d-flex align-items-center" style="width: 90%">
                                <span class="badge me-3" [style.background-color]="p.color || '#666'">
                                    {{ (p.type === 'progress' ? 'Progress Bar' : 'Text Value') | translate }}
                                </span>
                                <div>
                                    <strong>{{ p.label }}</strong>
                                    <div class="text-muted" style="font-size: 12px; font-family: monospace;">{{ p.command }}</div>
                                </div>
                            </div>
                            <button class="btn btn-sm btn-success text-white white-space-nowrap add-preset-btn" (click)="addPreset(p)" title="{{ 'Add to my metrics' | translate }}">
                                <i class="fas fa-plus"></i> <span translate>Add</span>
                            </button>
                        </div>
                    </div>
                </ng-container>
            </div>
        </div>

        <div class="separator"></div>

        <!-- 自定义指标管理区域 -->
        <div class="mt-4 mb-3">
            <h4 translate>Custom Metrics</h4>
            <div class="text-muted mb-2" style="font-size: 13px;" translate>
                Define custom shell commands to fetch data. The command must output a single value (number or text).
            </div>
        </div>

        <div class="list-group mb-3">
            <div class="list-group-item d-flex align-items-center justify-content-between user-select-none custom-metric-item" 
                 *ngFor="let metric of customMetrics; let i = index"
                 draggable="true"
                 (dragstart)="onDragStart(i)"
                 (dragover)="onDragOver($event, i)"
                 (drop)="onDrop(i)"
                 [class.opacity-50]="draggedIndex === i && !isDragging"
                 style="cursor: grab;">
                
                <div class="d-flex align-items-center" style="flex: 1">
                    <i class="fas fa-grip-vertical text-muted me-3" style="cursor: grab"></i>
                    
                    <span class="badge me-3" [style.background-color]="metric.color || '#666'">
                        {{ (metric.type === 'progress' ? 'Progress Bar' : 'Text Value') | translate }}
                    </span>
                    <div>
                        <strong>{{ metric.label }}</strong>
                        <div class="text-muted" style="font-size: 12px; font-family: monospace;">{{ metric.command }}</div>
                    </div>
                </div>

                <div class="btn-group">
                    <button class="btn btn-sm btn-outline-secondary" (click)="editMetric(i)" title="Edit">
                        <i class="fas fa-pen"></i>
                    </button>
                    <button class="btn btn-sm btn-outline-danger" (click)="removeMetric(i)" title="Remove">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            </div>
            
            <div class="list-group-item text-center text-muted" *ngIf="customMetrics.length === 0" translate>
                No custom metrics defined.
            </div>
        </div>

        <div class="card p-3 border">
            <h5 class="mb-3">{{ (editingIndex === -1 ? 'Add New Metric' : 'Edit Metric') | translate }}</h5>
            <div class="row g-2">
                <div class="col-md-3">
                    <label class="form-label" translate>Label</label>
                    <input type="text" class="form-control form-control-sm" [(ngModel)]="currentMetric.label" placeholder="e.g. GPU">
                </div>
                <div class="col-md-3">
                    <label class="form-label" translate>Type</label>
                    <select class="form-select form-select-sm" [(ngModel)]="currentMetric.type">
                        <option value="progress" translate>Progress Bar</option>
                        <option value="text" translate>Text Value</option>
                    </select>
                </div>
                <div class="col-md-2">
                    <label class="form-label" translate>Color</label>
                    <input type="color" class="form-control form-control-color form-control-sm w-100" [(ngModel)]="currentMetric.color">
                </div>
                <div class="col-md-2" *ngIf="currentMetric.type === 'progress'">
                    <label class="form-label" translate>Max Value</label>
                    <input type="number" class="form-control form-control-sm" [(ngModel)]="currentMetric.maxValue">
                </div>
                <div class="col-md-2" *ngIf="currentMetric.type === 'text'">
                    <label class="form-label" translate>Suffix</label>
                    <input type="text" class="form-control form-control-sm" [(ngModel)]="currentMetric.suffix" placeholder="e.g. °C">
                </div>
                <div class="col-md-12">
                    <label class="form-label" translate>Command (Shell)</label>
                    <div class="input-group input-group-sm">
                        <input type="text" class="form-control" [(ngModel)]="currentMetric.command" placeholder="echo 50">
                    </div>
                </div>
                <div class="col-md-12 mt-3 text-end">
                    <button class="btn btn-secondary btn-sm me-2" *ngIf="editingIndex !== -1" (click)="cancelEdit()" translate>
                        Cancel
                    </button>
                    <button class="btn btn-primary btn-sm text-white" (click)="saveMetric()" [disabled]="!currentMetric.label || !currentMetric.command">
                        <i class="fas" [class.fa-plus]="editingIndex === -1" [class.fa-save]="editingIndex !== -1"></i>
                        &nbsp;
                        {{ (editingIndex === -1 ? 'Add' : 'Save') | translate }}
                    </button>
                </div>
            </div>
        </div>
    `,
    styles: [`
        .param-input { width: 80px; text-align: right; }
        .user-select-none { user-select: none; }
        .opacity-50 { opacity: 0.5; }
        .separator { height: 1px; background: rgba(0,0,0,0.1); margin: 20px 0; }
        .white-space-nowrap { white-space: nowrap; }
        .add-preset-btn { width: 12%; justify-content: center; }
        .preset-category-title { font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; }
        .custom-metric-item { border: 1px solid rgba(100, 100, 100, 0.1); cursor: move; }
        :host-context(.theme-dark) .separator { background: rgba(255,255,255,0.1); }
    `]
})
export class ServerStatsSettingsComponent {
    defaultMetric: Partial<CustomMetric> = {
        type: 'progress',
        color: '#00ff00',
        maxValue: 100,
        suffix: ''
    };
    currentMetric: Partial<CustomMetric> = { ...this.defaultMetric };
    editingIndex = -1;
    draggedIndex: number | null = null;
    isDragging = false;

    // Built-in presets bundled with the plugin, grouped by category. No
    // remote/community loading — extend them in src/builtin-presets.ts.
    presetGroups = groupedBuiltinPresets();

    constructor(
        private translate: TranslateService,
        public config: ConfigService) {}

    get customMetrics(): CustomMetric[] {
        return this.config.store.plugin.serverStats.customMetrics || [];
    }
    
    onIntervalChange(value: any) {
        let seconds = Math.round(Number(value));
        if (!Number.isFinite(seconds)) seconds = 5;
        seconds = Math.min(60, Math.max(1, seconds));
        this.config.store.plugin.serverStats.pollInterval = seconds;
        this.save();
    }

    onSparklineBarsChange(value: any) {
        this.config.store.plugin.serverStats.sparklineBars = clampSparklineBars(value);
        this.save();
    }

    addPreset(preset: Partial<CustomMetric>) {
        // SECURITY: a preset's `command` is executed on every refresh on the active
        // session (locally or on the remote SSH host). Even though presets are now
        // bundled (no remote loading), still require explicit confirmation showing
        // the exact command.
        const cmd = preset.command || '';
        const warning = this.translate.instant(
            'This preset will run the following shell command on the active session (local or remote SSH host) on every refresh:'
        );
        const confirmRun = this.translate.instant('Add this metric?');
        if (!confirm(`${warning}\n\n${cmd}\n\n${confirmRun}`)) {
            return;
        }

        if (!this.config.store.plugin.serverStats.customMetrics) {
            this.config.store.plugin.serverStats.customMetrics = [];
        }

        const newMetric: CustomMetric = {
            id: Date.now().toString() + Math.random().toString().slice(2, 5),
            label: preset.label || 'New',
            command: preset.command || '',
            type: preset.type || 'text',
            color: preset.color || '#00ff00',
            maxValue: preset.maxValue || 100,
            suffix: preset.suffix || ''
        };

        this.config.store.plugin.serverStats.customMetrics.push(newMetric);
        this.save();
    }

    editMetric(index: number) {
        this.editingIndex = index;
        this.currentMetric = JSON.parse(JSON.stringify(this.customMetrics[index]));
    }

    cancelEdit() {
        this.editingIndex = -1;
        this.currentMetric = { ...this.defaultMetric };
    }

    saveMetric() {
        if (!this.currentMetric.label || !this.currentMetric.command) return;

        if (!this.config.store.plugin.serverStats.customMetrics) {
            this.config.store.plugin.serverStats.customMetrics = [];
        }

        const metricToSave: CustomMetric = {
            id: this.currentMetric.id || Date.now().toString(),
            label: this.currentMetric.label!,
            command: this.currentMetric.command!,
            type: this.currentMetric.type || 'text',
            color: this.currentMetric.color,
            maxValue: this.currentMetric.maxValue,
            suffix: this.currentMetric.suffix
        };

        if (this.editingIndex === -1) {
            this.config.store.plugin.serverStats.customMetrics.push(metricToSave);
        } else {
            this.config.store.plugin.serverStats.customMetrics[this.editingIndex] = metricToSave;
            this.editingIndex = -1;
        }

        this.save();
        this.currentMetric = { ...this.defaultMetric };
    }

    removeMetric(index: number) {
        if (confirm('Are you sure you want to delete this metric?')) {
            this.config.store.plugin.serverStats.customMetrics.splice(index, 1);
            this.save();
            if (this.editingIndex === index) {
                this.cancelEdit();
            }
        }
    }

    onDragStart(index: number) { this.draggedIndex = index; }
    onDragOver(event: DragEvent, index: number) { event.preventDefault(); }
    onDrop(targetIndex: number) {
        this.isDragging = false;
        if (this.draggedIndex === null || this.draggedIndex === targetIndex) return;
        const metrics = this.customMetrics;
        const item = metrics[this.draggedIndex];
        metrics.splice(this.draggedIndex, 1);
        metrics.splice(targetIndex, 0, item);
        this.config.store.plugin.serverStats.customMetrics = [...metrics];
        this.save();
        this.draggedIndex = null;
    }
    
    get hexColor(): string {
        const bg = this.config.store.plugin.serverStats.style.background;
        if (!bg) return '#141414';
        if (bg.startsWith('rgba')) {
            const parts = bg.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
            if (parts) {
                const r = parseInt(parts[1]).toString(16).padStart(2, '0');
                const g = parseInt(parts[2]).toString(16).padStart(2, '0');
                const b = parseInt(parts[3]).toString(16).padStart(2, '0');
                return `#${r}${g}${b}`;
            }
        }
        if (bg.startsWith('#')) return bg.substring(0, 7);
        return '#141414';
    }

    get opacity(): number {
        const bg = this.config.store.plugin.serverStats.style.background;
        if (!bg) return 0.9;
        if (bg.startsWith('rgba')) {
            const parts = bg.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
            if (parts && parts[4]) {
                return parseFloat(parts[4]);
            }
        }
        return 1.0;
    }

    setHexColor(hex: string) {
        const currentOpacity = this.opacity;
        this.updateColor(hex, currentOpacity);
    }

    setOpacity(val: number) {
        const currentHex = this.hexColor;
        this.updateColor(currentHex, val);
    }

    private updateColor(hex: string, opacity: number) {
        const r = parseInt(hex.slice(1, 3), 16);
        const g = parseInt(hex.slice(3, 5), 16);
        const b = parseInt(hex.slice(5, 7), 16);
        this.config.store.plugin.serverStats.style.background = `rgba(${r}, ${g}, ${b}, ${opacity})`;
        this.save();
    }

    save() { this.config.save(); }
}

@Injectable()
export class ServerStatsSettingsTabProvider extends SettingsTabProvider {
    constructor(private translate: TranslateService) {
        super();
        setTimeout(() => this.setTitle(this.translate.instant('Server Stats')), 10);
    }

    id = 'server-stats';
    icon = 'fas fa-server'; 
    title = this.translate.instant('Server Stats');

    setTitle(title: string) {
        this.title = title;
    }

    getComponentType(): any { return ServerStatsSettingsComponent; }
}