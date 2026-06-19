import { Injectable } from '@angular/core'
import { ConfigProvider } from 'tabby-core'

// Polling cadence shared by both display modes. Increased from 3s to 5s to cut
// steady-state load (fewer SSH channels / shell spawns), and combined with the
// active-tab-only scheduler so background tabs are not polled at all.
export const POLL_INTERVAL_MS = 5000

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