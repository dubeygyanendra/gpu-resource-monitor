import json, time, sys, psutil, subprocess

HAS_NVIDIA = False
HAS_AMD = False

# ---------- NVIDIA ----------
try:
    try:
        from nvidia_ml_py import *
    except ImportError:
        from pynvml import *

    nvmlInit()
    HAS_NVIDIA = True
except Exception as e:
    HAS_NVIDIA = False

# ---------- PROMETHEUS ----------
PROM = False
if "--prometheus" in sys.argv:
    PROM = True
    from prometheus_client import start_http_server, Gauge
    start_http_server(9100)
    PGPU = Gauge("gpu_util", "GPU util %", ["gpu"])
    PVRAM = Gauge("gpu_vram", "VRAM %", ["gpu"])

def get_nvidia_metrics():
    gpus = []
    count = nvmlDeviceGetCount()

    for i in range(count):
        h = nvmlDeviceGetHandleByIndex(i)

        mem = nvmlDeviceGetMemoryInfo(h)
        util = nvmlDeviceGetUtilizationRates(h)
        temp = nvmlDeviceGetTemperature(h, NVML_TEMPERATURE_GPU)
        power = nvmlDeviceGetPowerUsage(h) / 1000.0

        name_raw = nvmlDeviceGetName(h)
        name = name_raw.decode() if isinstance(name_raw, bytes) else name_raw

        vram_pct = (mem.used / mem.total) * 100

        if PROM:
            PGPU.labels(gpu=i).set(util.gpu)
            PVRAM.labels(gpu=i).set(vram_pct)

        gpus.append({
            "gpu": util.gpu,
            "vram": mem.used / 1e9,
            "vram_total": mem.total / 1e9,
            "temp": temp,
            "power": power,
            "name": name,
            "mig": 0
        })

    return gpus

def get_amd_metrics():
    # Safe stub: only activate if rocm-smi exists
    if subprocess.call(["which", "rocm-smi"],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL) != 0:
        return []

    # TODO: parse real values
    return [{
        "gpu": 0,
        "vram": 0,
        "vram_total": 0,
        "temp": 0,
        "power": 0,
        "name": "AMD GPU",
        "mig": 0
    }]

while True:
    try:
        if HAS_NVIDIA:
            gpus = get_nvidia_metrics()
        elif HAS_AMD:
            gpus = get_amd_metrics()
        else:
            gpus = []

        cpu = psutil.cpu_percent(interval=None)
        ram = psutil.virtual_memory().percent
        io = psutil.disk_io_counters()
        disk = psutil.disk_usage("/")

        payload = {
            "metrics": gpus,
            "gpu_list": gpus,
            "cpu": cpu,
            "ram": ram,
            "disk_read": io.read_bytes / 1e6,
            "disk_write": io.write_bytes / 1e6,
            "disk_used": disk.used / 1e9,
            "disk_total": disk.total / 1e9
        }

        print(json.dumps(payload), flush=True)
        time.sleep(1)

    except Exception as e:
        print(json.dumps({"error": str(e)}), flush=True)
        time.sleep(2)
