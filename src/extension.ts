import * as vscode from 'vscode';
import * as path from 'path';
import { spawn, ChildProcessWithoutNullStreams } from 'child_process';

export function activate(context: vscode.ExtensionContext) {
    const statusBar = vscode.window.createStatusBarItem(
        vscode.StatusBarAlignment.Left,
        100
    );
    statusBar.text = 'GPU: --%';
    statusBar.show();

    const provider = new GpuSystemMonitorProvider(
        context.extensionUri,
        context.globalState,
        statusBar
    );

    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(
            'gpuMonitorView',
            provider,
            { webviewOptions: { retainContextWhenHidden: true } }
        ),
        statusBar
    );
}

class GpuSystemMonitorProvider implements vscode.WebviewViewProvider {
    private proc?: ChildProcessWithoutNullStreams;

    constructor(
        private readonly extensionUri: vscode.Uri,
        private readonly globalState: vscode.Memento,
        private readonly statusBar: vscode.StatusBarItem
    ) {}

    resolveWebviewView(view: vscode.WebviewView) {
        view.title = 'GPU & System Monitor';
        view.description = 'Live GPU, CPU, RAM, Disk metrics';

        view.webview.options = {
            enableScripts: true,
            localResourceRoots: [this.extensionUri]
        };

        view.webview.html = this.getHtml();
        this.startAgent(view);

        view.webview.onDidReceiveMessage(msg => {
            if (msg.type === 'selectGpu') {
                this.globalState.update('selectedGpu', msg.value);
            }
        });
    }

    private startAgent(view: vscode.WebviewView) {
        const cfg = vscode.workspace.getConfiguration('gpuMonitor');

        const script = path.join(
            this.extensionUri.fsPath,
            'agent',
            'metrics.py'
        );

        const args = [script];
        if (cfg.get<boolean>('enablePrometheus', false)) {
            args.push('--prometheus');
        }

        this.proc = spawn('python3', args);

        this.proc.stdout.on('data', data => {
            data
                .toString()
                .split('\n')
                .forEach(line => {
                    if (!line.trim()) return;
                    try {
                        const payload = JSON.parse(line);

                        if (payload.metrics?.length) {
                            this.statusBar.text =
                                `GPU: ${payload.metrics[0].gpu.toFixed(0)}%`;
                        } else {
                            this.statusBar.text = 'GPU: n/a';
                        }

                        view.webview.postMessage({
                            payload,
                            thresholds: {
                                gpu: cfg.get<number>('alertGpu', 90),
                                vram: cfg.get<number>('alertVram', 90),
                                temp: cfg.get<number>('alertTemp', 85)
                            },
                            selectedGpu: this.globalState.get<number>(
                                'selectedGpu',
                                0
                            )
                        });
                    } catch {
                        // ignore malformed JSON
                    }
                });
        });

        this.proc.stderr.on('data', d => {
            console.error('[metrics.py]', d.toString());
        });
    }

    private getHtml(): string {
        return `
<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
<style>
body { font-family: sans-serif; }
#alert {
  display:none;
  background:#3a1c1c;
  color:#ffb3b3;
  padding:6px;
  margin-bottom:6px;
}
#nogpu {
  display:none;
  color:#aaa;
  margin-bottom:8px;
}
</style>
</head>
<body>

<div id="alert"></div>
<div id="nogpu">No GPU detected on this system.</div>

<label><b>Device:</b></label>
<select id="gpuSelect"></select>
<hr/>

<canvas id="gpu"></canvas>
<canvas id="vram"></canvas>
<canvas id="temp"></canvas>
<canvas id="power"></canvas>
<canvas id="cpu"></canvas>
<canvas id="ram"></canvas>
<canvas id="disk"></canvas>

<div id="diskSpace"></div>

<script>
const vscode = acquireVsCodeApi();

function mk(id, label) {
  return new Chart(document.getElementById(id), {
    type: 'line',
    data: { labels: [], datasets: [{ label, data: [] }] },
    options: { animation:false }
  });
}

const charts = {
  gpu: mk('gpu','GPU %'),
  vram: mk('vram','VRAM %'),
  temp: mk('temp','Temp °C'),
  power: mk('power','Power W'),
  cpu: mk('cpu','CPU %'),
  ram: mk('ram','RAM %'),
  disk: mk('disk','Disk MB/s')
};

const gpuSelect = document.getElementById('gpuSelect');
let selectedGpu = 0;

gpuSelect.onchange = () => {
  selectedGpu = Number(gpuSelect.value);
  vscode.postMessage({ type:'selectGpu', value:selectedGpu });
};

window.addEventListener('message', event => {
  const { payload, thresholds, selectedGpu: saved } = event.data;
  if (!payload) return;

  if (!payload.metrics || payload.metrics.length === 0) {
    document.getElementById('nogpu').style.display='block';
    return;
  }

  document.getElementById('nogpu').style.display='none';

  if (gpuSelect.children.length === 0) {
    payload.gpu_list.forEach((g,i)=>{
      const o=document.createElement('option');
      o.value=i;
      o.textContent=\`[\${g.gpu}] \${g.name}\${g.mig?' (MIG)':''}\`;
      gpuSelect.appendChild(o);
    });
    selectedGpu = saved ?? 0;
    gpuSelect.value = selectedGpu;
  }

  const g = payload.metrics[selectedGpu];
  if (!g) return;

  const ts = new Date().toLocaleTimeString();
  const vramPct = (g.vram / g.vram_total) * 100;

  push(charts.gpu, ts, g.gpu);
  push(charts.vram, ts, vramPct);
  push(charts.temp, ts, g.temp);
  push(charts.power, ts, g.power);
  push(charts.cpu, ts, payload.cpu);
  push(charts.ram, ts, payload.ram);
  push(charts.disk, ts, payload.disk_read + payload.disk_write);

  document.getElementById('diskSpace').textContent =
    \`Disk: \${payload.disk_used.toFixed(1)} / \${payload.disk_total.toFixed(1)} GB\`;

  const alertBox = document.getElementById('alert');
  if (
    g.gpu > thresholds.gpu ||
    vramPct > thresholds.vram ||
    g.temp > thresholds.temp
  ) {
    alertBox.textContent =
      \`High usage: GPU \${g.gpu}% | VRAM \${vramPct.toFixed(1)}% | Temp \${g.temp}°C\`;
    alertBox.style.display = 'block';
  } else {
    alertBox.style.display = 'none';
  }
});

function push(c, ts, val) {
  c.data.labels.push(ts);
  c.data.datasets[0].data.push(val);
  if (c.data.labels.length > 60) {
    c.data.labels.shift();
    c.data.datasets[0].data.shift();
  }
  c.update();
}
</script>
</body>
</html>
`;
    }
}
