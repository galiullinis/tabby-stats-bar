import { Injectable } from '@angular/core'
import { ConfigService } from 'tabby-core'
import { CustomMetric } from '../config'
import { exec } from 'child_process'
import { MARKERS, parseStatsOutput, buildCustomMetricsFragment } from './stats-parser'
import { execSshCommand } from './ssh-exec'

@Injectable({ providedIn: 'root' })
export class StatsService {
    // 修复：支持 Linux 和 macOS，增强了错误处理和环境兼容性
    // Thanks: https://blog.csdn.net/weixin_41635157/article/details/156060209?spm=1011.2415.3001.5331
    private baseStatsCommand = `export LC_ALL=C; PATH=$PATH:/usr/bin:/bin:/usr/sbin:/sbin; OS=$(uname -s 2>/dev/null || echo "Linux"); if [ "$OS" = "Darwin" ]; then cpu=$(ps -A -o %cpu | awk '{s+=$1} END {print s}' 2>/dev/null || echo "0"); mem=$(ps -A -o %mem | awk '{s+=$1} END {print s}' 2>/dev/null || echo "0"); disk=$(df -h / 2>/dev/null | awk 'NR==2{print $5}' | sed 's/%//' || echo "0"); echo "TABBY-STATS-START $cpu 0 0 $mem $disk"; else stats=$( (grep 'cpu ' /proc/stat; awk 'NR>2 {r+=$2; t+=$10} END{print r, t}' /proc/net/dev; sleep 1; grep 'cpu ' /proc/stat; awk 'NR>2 {r+=$2; t+=$10} END{print r, t}' /proc/net/dev) 2>/dev/null | awk 'NR==1 {t1=$2+$3+$4+$5+$6+$7+$8; i1=$5} NR==2 {rx1=$1; tx1=$2} NR==3 {t2=$2+$3+$4+$5+$6+$7+$8; i2=$5} NR==4 {rx2=$1; tx2=$2} END { dt=t2-t1; di=i2-i1; cpu=(dt<=0)?0:(dt-di)/dt*100; rx=rx2-rx1; tx=tx2-tx1; printf "%.1f %.0f %.0f", cpu, rx, tx }' ); mem=$(free 2>/dev/null | awk 'NR==2{printf "%.2f", $3*100/$2 }'); disk=$(df -h / 2>/dev/null | awk 'NR==2{print $5}' | sed 's/%//'); if [ -z "$stats" ]; then stats="0 0 0"; fi; if [ -z "$mem" ]; then mem="0"; fi; if [ -z "$disk" ]; then disk="0"; fi; echo "TABBY-STATS-START $stats $mem $disk"; fi`
    private fetchGuards = new WeakMap<any, boolean>();

    constructor(private config: ConfigService) {}

    isPlatformSupport(session: any): boolean {
        const sshClient = session.ssh && session.ssh.ssh ? session.ssh.ssh : null;
        const isSSH = sshClient && typeof sshClient.openSessionChannel === 'function';
        return isSSH || process.platform === 'linux' || process.platform === 'darwin';
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

            let output: string | null = null;

            if (isSSH) {
                output = await this.exec(sshClient, finalCommand);
            } else if (isLocalSupported) {
                output = await this.execLocal(finalCommand);
            }

            const result = parseStatsOutput(output || '', customMetrics);

            this.fetchGuards.delete(session);
            return result;

        } catch (e) {
            // console.error('Stats: Fetch Error:', e);
            this.fetchGuards.delete(session);
        }
        
        return null;
    }

    private execLocal(cmd: string): Promise<string> {
        return new Promise((resolve) => {
            exec(cmd, { timeout: 5000 }, (error, stdout) => {
                if (error) {
                    // console.error('Stats: Local Exec Error', error);
                    resolve('');
                } else {
                    resolve(stdout);
                }
            });
        });
    }

    private exec(sshClient: any, cmd: string): Promise<string> {
        // Delegates to execSshCommand, which guarantees the channel and the
        // data$ subscription are torn down on success, error AND timeout.
        return execSshCommand(sshClient, cmd, { timeoutMs: 5000, endMarker: MARKERS.end });
    }
}
