# 加工件采购分发管理 (machining-dispatch)

一个**本地、离线**的桌面工具,帮采购人员管住一件事:**哪一版图纸发给了哪家厂商、发没发。**

适用场景:有几十个加工件、对接多家厂商,图纸还会改版,容易记不清谁手里拿的是哪一版。

## 核心功能

- **零件 × 厂商状态矩阵**:一眼看清每个零件对每家厂商的状态 —— ✅ 已发最新 / ⚠️ 需重发 / ○ 未发送 / — 未指派。
- **图纸改版自动预警**:一个零件可挂多个文件(2D 图、3D 图、子零件图);任何文件增/换/删都让该零件「修订号 +1」,所有还拿着旧版的厂商自动标黄,提醒重发。
- **一键打包**:为某家厂商生成 zip(每个零件一个文件夹,装入其全部当前图纸)+ 自动生成的中文「需求单.pdf」;生成即自动记录发送历史(无需手动打勾)。
- **数据全在本地**:存放于「文档/加工件管理」,不联网、不登录,可直接复制备份。

> 工具职责到「产出 zip + 记录」为止;发送仍由用户自己通过微信完成。

## 技术栈

Electron + React + Vite + Tailwind。主进程(Node)负责文件存取、打包(jszip)、中文 PDF(Electron `printToPDF`);渲染层是 React 界面;通过 IPC(`window.api`)通信。打包为免安装的 Windows 便携 exe(electron-builder)。

## 开发

```bash
npm install      # 安装依赖
npm run dev      # 本地开发(热更新)
npm run build    # 仅构建
npm run dist     # 构建并打包成 Windows 便携 exe(产物在 dist/)
```

要求 Node 20。依赖版本已按 Node 20 锁定(electron 38 / electron-builder 25 / vite 7 / @vitejs/plugin-react 5 / tailwind 3),请勿盲目升级。

## 目录

```
src/
  main/      主进程:窗口、IPC、数据层(store.js)、打包器(packager.js)
  preload/   contextBridge 暴露 window.api
  renderer/  React + Tailwind 界面(仪表盘 / 零件 / 厂商 / 打包 / 设置)
使用说明.md    给最终用户的中文使用说明
```

数据文件夹(运行期生成,不入库):`文档/加工件管理/`(data.json + drawings/ + packages/)。
