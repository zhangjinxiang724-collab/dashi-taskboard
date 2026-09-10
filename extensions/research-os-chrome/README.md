# Research OS Chrome Capture

这个扩展只在用户主动点击时读取当前打开的 ChatGPT 对话，并把捕获结果发送到本机 Research OS Preview。

## 构建与加载

```bash
npm run build:extension
```

然后在 Chrome 打开 `chrome://extensions`：

1. 开启“开发者模式”。
2. 点击“加载已解压的扩展程序”。
3. 选择仓库中的 `dist/research-os-chrome`。

## 首次配对

1. 打开 Research OS 的“研究”页面。
2. 点击“连接浏览器扩展”，生成一次性配对码。
3. 点击 Chrome 工具栏中的 Research OS 扩展，粘贴配对码。

配对完成后，打开一条普通 ChatGPT 对话或 Project 内的具体对话，再点击扩展中的“捕获当前对话”。

## 权限边界

- 只申请 `activeTab`、`scripting` 和 `storage`。
- 默认连接 `http://127.0.0.1:47823`；可以在扩展的“本地地址设置”中改为其他 `127.0.0.1` 或 `localhost` 端口。
- 扩展拒绝公网、局域网和 `0.0.0.0` 地址。
- 不读取 Cookie、浏览历史或剪贴板。
- 不在后台自动扫描 ChatGPT。
- 捕获完成后必须在 Research OS Preview 中由用户确认，才会写入 Research Record。
