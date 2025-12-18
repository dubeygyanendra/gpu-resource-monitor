# GPU & System Monitor for VS Code

A real-time system monitoring extension for Visual Studio Code that displays GPU, CPU, RAM, and Disk metrics directly in the sidebar.

Designed for GPU servers, ML workloads, and Remote-SSH development.

---

## Features

### GPU Monitoring
- NVIDIA GPU support via NVML
- Multi-GPU selector
- MIG-aware (instances shown as separate devices)
- GPU utilization, VRAM usage, temperature, and power

### System Monitoring
- CPU usage
- RAM usage
- Disk I/O (read + write)
- Disk space (used / total)

### UI & UX
- Live charts in the VS Code sidebar
- Non-intrusive alert banner (no popups, no focus stealing)
- Status bar GPU usage indicator
- GPU selection persists across reloads
- Graceful fallback when no GPU is detected

### Integrations
- Optional Prometheus metrics endpoint (disabled by default)
- Works seamlessly over Remote-SSH

---

## Requirements

### Minimum
- VS Code 1.80+
- Python 3.8+

### NVIDIA GPU support
- NVIDIA drivers installed
- NVML available
- Python packages:
  ```bash
  pip install nvidia-ml-py psutil
