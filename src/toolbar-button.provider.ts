import { Injectable } from '@angular/core'
import { ToolbarButtonProvider, ToolbarButton, ConfigService, TranslateService } from 'tabby-core'

@Injectable()
export class StatsToolbarButtonProvider extends ToolbarButtonProvider {
    constructor(private config: ConfigService, private translate: TranslateService) { super() }
    
    provide(): ToolbarButton[] {
        return [{
            icon: require('./icons/activity.svg'),
            title: this.translate.instant('Show Server Stats'),
            click: () => {
                if (!this.config.store.plugin) this.config.store.plugin = {};
                if (!this.config.store.plugin.serverStats) this.config.store.plugin.serverStats = {};

                const current = this.config.store.plugin.serverStats.enabled
                this.config.store.plugin.serverStats.enabled = !current
                // config.save() emits config.changed$, which both display
                // components are subscribed to — they refresh themselves. No need
                // for global window.* references to the component instances.
                this.config.save();
            }
        }]
    }
}