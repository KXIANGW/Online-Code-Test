# K8s Node 2 Setup - Dedicated Judge Worker Node

Node 2 是專用 judge worker node。建議內網 IP：

```text
192.168.50.210
```

Node 2 預期只放：

- `worker`
- `language-rootfs-puller`
- `cadvisor`
- 必要 kube-system Pod

不應放：

- `frontend`
- `backend`
- `postgres`
- `rabbitmq`
- `redis`
- `prometheus`
- `grafana`

---

## 1. 基礎套件

```bash
sudo apt update
sudo apt install -y curl ca-certificates gnupg lsb-release jq git socat
```

確認 cgroup v2：

```bash
stat -fc %T /sys/fs/cgroup
# 預期：cgroup2fs
```


## 防火牆設定

實驗室重建階段建議先關閉 UFW，避免 k3s agent join、Flannel VXLAN、kubelet metrics 或 NodePort 被防火牆擋住。等三節點 cluster 與 OCT 都驗證完成後，再視需要重新啟用防火牆。

在 Node 2 (`192.168.50.210`) 執行：

```bash
sudo ufw status verbose
sudo ufw disable
sudo ufw status verbose
```

Node 2 是 agent；防火牆關閉後，它會主動連到 Node 1 的 `https://192.168.50.208:6443`。

若之後要重新啟用 UFW，至少要允許以下內網流量：

- Node 1: `6443/tcp` 允許 Node 2 / Node 3 連入。
- All nodes: `8472/udp` 允許三台 node 彼此連線，給 Flannel VXLAN。
- All nodes: `10250/tcp` 允許三台 node 彼此連線，給 kubelet / metrics server。
- All nodes: `31000/tcp` 允許內網或外部 reverse proxy 連入 frontend NodePort。

不要把 `8472/udp` 開到公網。

## 2. 從 Node 1 取得加入資訊

在 Node 1 執行：

```bash
sudo cat /var/lib/rancher/k3s/server/node-token
```

Node 2 會用到：

```bash
K3S_URL="https://192.168.50.208:6443"
K3S_TOKEN="貼上 Node 1 輸出的 token"
```

請確認 Node 2 可以連到 Node 1：

```bash
ping -c 3 192.168.50.208
curl -k https://192.168.50.208:6443/readyz
```

`/readyz` 可能回傳權限錯誤或 ok；重點是 TCP/TLS 連線不能 timeout。

## 3. 安裝 k3s agent

先寫入 agent config：

```bash
sudo mkdir -p /etc/rancher/k3s
sudo tee /etc/rancher/k3s/config.yaml >/dev/null <<'EOF'
kubelet-arg:
  - cgroup-driver=systemd
node-ip: 192.168.50.210
EOF
```

安裝 agent：

```bash
curl -sfL https://get.k3s.io | sudo env K3S_URL="$K3S_URL" K3S_TOKEN="$K3S_TOKEN" sh -
```

驗證 agent：

```bash
systemctl is-active k3s-agent
sudo journalctl -u k3s-agent -n 80 --no-pager
```

## 4. 在 Node 1 設定 label / taint

回到 Node 1 執行：

```bash
kubectl get nodes -o wide
```

找到 Node 2 的實際名稱後：

```bash
NODE2="填入 Node 2 的 kubectl node name"

kubectl label node "$NODE2" oct-role=judge --overwrite
kubectl taint node "$NODE2" oct-role=judge:NoSchedule --overwrite
```

驗證：

```bash
kubectl get nodes --show-labels
kubectl describe node "$NODE2" | grep -A3 Taints
```

## 5. Worker 所需 hostPath

`language-rootfs-puller` 會自動建立並寫入：

```text
/var/lib/oct/rootfs
```

`worker` 會使用：

```text
/var/lib/oct/rootfs
/tmp/oct-k8s-judge
```

可先建立目錄，避免權限或磁碟位置不明確：

```bash
sudo mkdir -p /var/lib/oct/rootfs
sudo mkdir -p /tmp/oct-k8s-judge
```

## 6. 預期 Kubernetes manifest 設定

`worker` Deployment 應有：

```yaml
nodeSelector:
  oct-role: judge
tolerations:
  - key: oct-role
    operator: Equal
    value: judge
    effect: NoSchedule
```

`language-rootfs-puller` DaemonSet 也應有同樣設定，確保 rootfs 只在 Node 2 準備。

`cadvisor` 若要跑在 Node 2，也要能 tolerate：

```yaml
tolerations:
  - key: oct-role
    operator: Equal
    value: judge
    effect: NoSchedule
```

## 7. 驗證 worker 是否只跑在 Node 2

在 Node 1 執行：

```bash
kubectl -n oct get pods -o wide | grep -E 'worker|language-rootfs-puller|cadvisor'
```

預期：

- `worker` 在 Node 2。
- `language-rootfs-puller` 在 Node 2。
- `cadvisor` 可以在 Node 2。

確認一般服務沒有跑到 Node 2：

```bash
kubectl -n oct get pods -o wide | grep "$NODE2"
```

不應看到：

- `frontend`
- `backend`
- `postgres`
- `rabbitmq`
- `redis`
- `prometheus`
- `grafana`

## 8. 驗證 rootfs

在 Node 1 執行：

```bash
kubectl -n oct logs ds/language-rootfs-puller
kubectl -n oct exec deploy/worker -- sh -c 'ls -la /var/lib/oct/rootfs'
```

預期至少看到：

```text
cpp17
python3
```

## 9. 驗證 worker

```bash
kubectl -n oct logs deploy/worker | grep -E "sandbox engine|judge consumer"
```

預期：

```text
[worker] sandbox engine = isolate
[worker] judge consumer started
```

## 10. KEDA 擴縮驗證

在 Node 1 執行：

```bash
kubectl -n oct get scaledobject worker
kubectl -n oct get deploy worker -w
```

製造 queue depth 後，worker replica 可以從 1 增加到最多 5，但都應該排在 Node 2：

```bash
kubectl -n oct get scaledobject worker
kubectl -n oct get hpa keda-hpa-worker
kubectl -n oct get pods -l app=worker -o wide
```

## 11. NodePort 驗證

即使 frontend Pod 不在 Node 2，kube-proxy 仍應該讓 Node 2 的 NodePort 可用：

```bash
curl -I http://192.168.50.210:31000
```

如果失敗，請檢查：

```bash
kubectl -n oct get svc frontend
sudo iptables-save | grep 31000
sudo systemctl status k3s-agent
```
