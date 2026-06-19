import { Injectable } from '@angular/core'
import { ConfigService } from 'tabby-core'
import { CustomMetric } from '../config'
import { exec } from 'child_process'
import {
    MARKERS,
    parseBaseSample,
    finalizeSample,
    parseCustom,
    buildCustomMetricsFragment,
    DeltaSample,
} from './stats-parser'
import { execSshCommand } from './ssh-exec'
import { clampPollIntervalMs, adaptiveTimeoutMs } from './poll-timing'

@Injectable({ providedIn: 'root' })
export class StatsService {
    // Cheap, NON-sleeping stats command.
    //
    // Linux (mode "D" = delta): reads raw kernel counters from /proc in one shot
    //   (no `sleep 1`). CPU% and network byte/s are derived CLIENT-SIDE by diffing
    //   against the previous sample (see finalizeSample). This is what makes fast
    //   (e.g. 1s) polling viable — each remote call returns immediately.
    // macOS (mode "V" = values): emits already-computed values (no cheap /proc).
    //
    // Linux fields after "D": cpuTotal cpuIdle rxBytes txBytes mem% disk%
    // macOS fields after "V": cpu% rx tx mem% disk%
    private baseStatsCommand = `export LC_ALL=C; PATH=$PATH:/usr/bin:/bin:/usr/sbin:/sbin; OS=$(uname -s 2>/dev/null || echo Linux); if [ "$OS" = "Darwin" ]; then set -- $(ps -A -o %cpu= -o %mem= 2>/dev/null | awk '{c+=$1; m+=$2} END {printf "%.1f %.1f", c+0, m+0}'); cpu=$1; mem=$2; disk=$(df -P / 2>/dev/null | awk 'NR==2{gsub(/%/,"",$5); print $5}'); if [ -z "$cpu" ]; then cpu=0; fi; if [ -z "$mem" ]; then mem=0; fi; if [ -z "$disk" ]; then disk=0; fi; echo "TABBY-STATS-START V $cpu 0 0 $mem $disk"; else cpu=$(awk '/^cpu /{print $2+$3+$4+$5+$6+$7+$8, $5; exit}' /proc/stat 2>/dev/null); net=$(awk 'NR>2 && $1!="lo:"{rx+=$2; tx+=$10} END {print rx+0, tx+0}' /proc/net/dev 2>/dev/null); mem=$(awk '/^MemTotal/{t=$2} /^MemAvailable/{a=$2} END {if (t>0) printf "%.1f", (t-a)/t*100; else print 0}' /proc/meminfo 2>/dev/null); disk=$(df -P / 2>/dev/null | awk 'NR==2{gsub(/%/,"",$5); print $5}'); if [ -z "$cpu" ]; then cpu="0 0"; fi; if [ -z "$net" ]; then net="0 0"; fi; if [ -z "$mem" ]; then mem=0; fi; if [ -z "$disk" ]; then disk=0; fi; echo "TABBY-STATS-START D $cpu $net $mem $disk"; fi`

    // Per-session guard (no overlapping fetch for the same session) and previous
    // raw sample (for client-side delta computation).
    private fetchGuards = new WeakMap<any, boolean>();
    private prevSamples = new WeakMap<any, DeltaSample>();

    constructor(private config: ConfigService) {}

    isPlatformSupport(session: any): boolean {
        const sshClient = session.ssh && session.ssh.ssh ? session.ssh.ssh : null;
        const isSSH = sshClient && typeof sshClient.openSessionChannel === 'function';
        return isSSH || process.platform === 'linux' || process.platform === 'darwin';
    }

    private getTimeoutMs(): number {
        const seconds = this.config.store?.plugin?.serverStats?.pollInterval;
        return adaptiveTimeoutMs(clampPollIntervalMs(seconds));
    }

    async fetchStats(session: any): Promise<any | null> {
        if (!session) return null;

        if (this.fetchGuards.get(session)) {
            return null;
        }
        this.fetchGuards.set(session, true);

        try {
            const sshClient = session.ssh && session.ssh.ssh ? session.ssh.ssh : null;
            const isSSH = sshClient && typeof sshClient.openSessionChannel === 'function';
            const isLocalSupported = !isSSH && (process.platform === 'linux' || process.platform === 'darwin');

            if (!isSSH && !isLocalSupported) {
                this.fetchGuards.delete(session);
                return null;
            }

            const customMetrics: CustomMetric[] = this.config.store.plugin.serverStats.customMetrics || [];

            let finalCommand = this.baseStatsCommand;
            finalCommand += buildCustomMetricsFragment(customMetrics);
            finalCommand += `; echo " ${MARKERS.end}"`;
            finalCommand = finalCommand.replace(/\n/g, ' ');
            finalCommand = `/bin/sh -c '${finalCommand.replace(/'/g, "'\\''")}'`;

            const timeoutMs = this.getTimeoutMs();
            let output: string | null = null;

            if (isSSH) {
                output = await this.exec(sshClient, finalCommand, timeoutMs);
            } else if (isLocalSupported) {
                output = await this.execLocal(finalCommand, timeoutMs);
            }

            const base = parseBaseSample(output || '');
            if (!base) {
                this.fetchGuards.delete(session);
                return null;
            }

            const prev = this.prevSamples.get(session);
            const { stats, nextSample } = finalizeSample(base, prev, Date.now());
            if (nextSample) {
                this.prevSamples.set(session, nextSample);
            }
            const custom = parseCustom(output || '', customMetrics);
            if (custom) {
                (stats as any).custom = custom;
            }

            this.fetchGuards.delete(session);
            return stats;

        } catch (e) {
            // console.error('Stats: Fetch Error:', e);
            this.fetchGuards.delete(session);
        }

        return null;
    }

    private execLocal(cmd: string, timeoutMs: number): Promise<string> {
        return new Promise((resolve) => {
            exec(cmd, { timeout: timeoutMs }, (error, stdout) => {
                if (error) {
                    // console.error('Stats: Local Exec Error', error);
                    resolve('');
                } else {
                    resolve(stdout);
                }
            });
        });
    }

    private exec(sshClient: any, cmd: string, timeoutMs: number): Promise<string> {
        // Delegates to execSshCommand, which guarantees the channel and the
        // data$ subscription are torn down on success, error AND timeout.
        return execSshCommand(sshClient, cmd, { timeoutMs, endMarker: MARKERS.end });
    }
}
