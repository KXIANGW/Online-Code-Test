# K8s Node 1 Setup - Master / App Node

Node 1 是 k3s control-plane，也作為 app 入口節點。建議內網 IP：

```text
192.168.50.208
```

Node 1 預期放置：

- `frontend`
- `backend`
- k3s control-plane components
- Argo CD / KEDA / kube-system 預設排程元件

---

## 1. 基礎套件與 GitHub/GHCR 變數

```bash
sudo apt update
sudo apt install -y curl ca-certificates gnupg lsb-release jq git socat apt-transport-https
```

OCT images 會從 GHCR 拉取，Argo CD/Image Updater 也會用到 GitHub token。請先在 Node 1 設定：

```bash
cat > ~/.oct-ghcr-env <<'EOF'
export GITHUB_USER="UserName"
export GITHUB_PAT="<github-classic-pat-with-repo-and-read-packages>"
EOF

chmod 600 ~/.oct-ghcr-env
grep -qxF 'source ~/.oct-ghcr-env' ~/.bashrc || echo 'source ~/.oct-ghcr-env' >> ~/.bashrc
source ~/.oct-ghcr-env

test -n "$GITHUB_USER" && echo "GITHUB_USER loaded"
test -n "$GITHUB_PAT" && echo "GITHUB_PAT loaded"
```

確認 cgroup v2：

```bash
stat -fc %T /sys/fs/cgroup
# 預期：cgroup2fs
```


## 防火牆設定

實驗室重建階段建議先關閉 UFW，避免 k3s agent join、Flannel VXLAN、kubelet metrics 或 NodePort 被防火牆擋住。等三節點 cluster 與 OCT 都驗證完成後，再視需要重新啟用防火牆。

在 Node 1 (`192.168.50.208`) 執行：

```bash
sudo ufw status verbose
sudo ufw disable
sudo ufw status verbose
```

Node 1 是 k3s server；防火牆關閉後，Node 2 / Node 3 才能連到 `https://192.168.50.208:6443` 加入 cluster。

若之後要重新啟用 UFW，至少要允許以下內網流量：

- Node 1: `6443/tcp` 允許 Node 2 / Node 3 連入。
- All nodes: `8472/udp` 允許三台 node 彼此連線，給 Flannel VXLAN。
- All nodes: `10250/tcp` 允許三台 node 彼此連線，給 kubelet / metrics server。
- All nodes: `31000/tcp` 允許內網或外部 reverse proxy 連入 frontend NodePort。

不要把 `8472/udp` 開到公網。

## 2. 安裝 k3s server

Worker 使用 isolate，需要 systemd cgroup driver。先寫入 k3s config：

```bash
sudo mkdir -p /etc/rancher/k3s
sudo tee /etc/rancher/k3s/config.yaml >/dev/null <<'EOF'
kubelet-arg:
  - cgroup-driver=systemd
node-ip: 192.168.50.208
advertise-address: 192.168.50.208
EOF
```

安裝 k3s server：

```bash
curl -sfL https://get.k3s.io | sudo INSTALL_K3S_EXEC="--disable=traefik --write-kubeconfig-mode=644" sh -
```

設定 kubectl：

```bash
export KUBECONFIG=/etc/rancher/k3s/k3s.yaml
grep -qxF 'export KUBECONFIG=/etc/rancher/k3s/k3s.yaml' ~/.bashrc || echo 'export KUBECONFIG=/etc/rancher/k3s/k3s.yaml' >> ~/.bashrc
```

驗證：

```bash
systemctl is-active k3s
kubectl get nodes -o wide
```

## 3. 取得 Node Token

Node 2 / Node 3 加入 cluster 時會用到：

```bash
sudo cat /var/lib/rancher/k3s/server/node-token
```

請暫時記下：

```text
K3S_TOKEN=貼上 Node 1 輸出的 token
K3S_URL=https://192.168.50.208:6443
```

## 4. 等 Node 2 / Node 3 加入

在 Node 2 / Node 3 完成 agent 安裝後，回到 Node 1 執行：

```bash
kubectl get nodes -o wide
```

確認三台 node 都是 `Ready`。

## 5. 設定 Node label / taint

先查實際 node 名稱：

```bash
kubectl get nodes
```

假設名稱如下：

```bash
NODE1="填入 Node 1 的 kubectl node name"
NODE2="填入 Node 2 的 kubectl node name"
NODE3="填入 Node 3 的 kubectl node name"
```

設定 label：

```bash
kubectl label node "$NODE1" oct-role=app --overwrite
kubectl label node "$NODE2" oct-role=judge --overwrite
kubectl label node "$NODE3" oct-role=data --overwrite
```

讓 Node 2 成為 worker-only node：

```bash
kubectl taint node "$NODE2" oct-role=judge:NoSchedule --overwrite
```

驗證：

```bash
kubectl get nodes --show-labels
kubectl describe node "$NODE2" | grep -A3 Taints
```

## 6. 安裝 Helm / KEDA / Argo CD / OCT

如果這是全新 cluster，順序是：Helm -> KEDA -> Argo CD -> Argo CD Image Updater -> GHCR imagePullSecret -> OCT application。

安裝 Helm：

```bash
curl -fsSL https://packages.buildkite.com/helm-linux/helm-debian/gpgkey \
  | gpg --dearmor \
  | sudo tee /usr/share/keyrings/helm.gpg >/dev/null

echo "deb [signed-by=/usr/share/keyrings/helm.gpg] https://packages.buildkite.com/helm-linux/helm-debian/any/ any main" \
  | sudo tee /etc/apt/sources.list.d/helm-stable-debian.list

sudo apt update
sudo apt install -y helm
helm version
```

安裝 KEDA：

```bash
helm repo add kedacore https://kedacore.github.io/charts
helm repo update
helm upgrade --install keda kedacore/keda --namespace keda --create-namespace
kubectl -n keda rollout status deployment/keda-operator --timeout=180s
kubectl get crd scaledobjects.keda.sh
```

安裝 Argo CD：

```bash
kubectl create namespace argocd --dry-run=client -o yaml | kubectl apply -f -
kubectl apply -n argocd -f https://raw.githubusercontent.com/argoproj/argo-cd/stable/manifests/install.yaml --server-side --force-conflicts
kubectl wait --for=condition=available --timeout=180s deployment/argocd-server -n argocd
```

安裝 Argo CD Image Updater：

```bash
kubectl apply -n argocd -f https://raw.githubusercontent.com/argoproj-labs/argocd-image-updater/v1.2.0/config/install.yaml
kubectl -n argocd rollout status deployment/argocd-image-updater-controller --timeout=180s
kubectl apply -f k8s/argocd/image-updater-config.yaml
kubectl apply -f k8s/argocd/image-updater.yaml
```

OCT namespace 與 GHCR secret：

```bash
kubectl create namespace oct --dry-run=client -o yaml | kubectl apply -f -

kubectl -n oct create secret docker-registry ghcr-secret \
  --docker-server=ghcr.io \
  --docker-username="$GITHUB_USER" \
  --docker-password="$GITHUB_PAT" \
  --dry-run=client -o yaml | kubectl apply -f -
```

部署 OCT 可以二選一。若要先直接確認 manifests，可直接套用：

```bash
kubectl apply -k k8s/
```

若要讓 Argo CD 接手 GitOps 同步，改套用 Application：

```bash
kubectl apply -f k8s/argocd/application.yaml
kubectl -n argocd get application oct-app
```

不要同時用兩種流程反覆改同一批資源；初次實驗建議先用 `kubectl apply -k k8s/`，確認跨 node 分布正常後再切到 Argo CD。

## 7. 對外 NodePort 驗證

等 `frontend` Ready 後：

```bash
kubectl -n oct get svc frontend
curl -I http://192.168.50.208:31000
```

## 8. Pod 分布驗證

```bash
kubectl -n oct get pods -o wide
```

預期：

- `frontend`、`backend` 優先在 Node 1。
- `worker` 在 Node 2。
- `postgres`、`rabbitmq`、`redis`、`prometheus`、`grafana` 在 Node 3。

## 9. 外部 Nginx upstream 參考

外部 Nginx 不一定在 Node 1 上，但設定可參考：

```nginx
upstream frontend_cluster {
    server 140.114.76.11:5173;
    server 140.114.76.11:5174;
    server 140.114.76.11:5175;
}

server {
    listen 443 ssl http2;
    server_name ikmlab.cs.nthu.edu.tw;

    location / {
        proxy_pass http://frontend_cluster;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 60s;
    }
}
```

## 10. 常用檢查

```bash
kubectl get nodes -o wide
kubectl get pods -A -o wide
kubectl -n oct get hpa
kubectl -n oct get scaledobject
kubectl -n oct get svc
```

預期 autoscaling 範圍：

- `frontend` HPA：1~3 Pods。
- `backend` HPA：1~3 Pods。
- `worker` KEDA ScaledObject：1~5 Pods。
