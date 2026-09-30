import { Injectable } from '@angular/core'
import { ConfigProvider } from 'tabby-core'

export interface CustomMetric {
    id: string
    label: string
    command: string
    type: 'progress' | 'text'
    color?: string
    suffix?: string
    maxValue?: number
}

@Injectable()
export class ServerStatsConfigProvider extends ConfigProvider {
    defaults = {
        plugin: {
            serverStats: {
                enabled: true,
                debug: false,
                pollInterval: 5,
                cpuStyle: 'bar',
                ramStyle: 'bar',
                diskStyle: 'single',
                netStyle: 'stacked',
                // Network speed unit: 'bits' (Kb/s, Mb/s — SI, like link speeds and Grafana) or 'bytes' (K/s, M/s — binary).
                netUnit: 'bits',
                showIoWait: false,
                // First-class optional metrics (were built-in presets before).
                showUptime: false,
                showLoad: false,
                showUsers: false,
                showSessions: false,
                // What the bottom bar does when the metrics no longer fit:
                // 'scroll' keeps one row and adds arrow buttons, 'wrap' grows taller.
                overflowMode: 'scroll',
                sparklineBars: 40,
                displayMode: 'bottomBar',
                location: { x: null, y: null },
                style: {
                    background: 'rgba(20, 20, 20, 0.90)',
                    size: 100,
                    layout: 'vertical'
                },
                customMetrics: [] as CustomMetric[] 
            }
        }
    }
}