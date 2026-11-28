# 源码包与构建交付说明

本文档规定 DeepSaga 源码包的内容、构建输入、校验方式与交付边界。源码许可以 [LICENSE](LICENSE) 为准，来源与署名以 [NOTICE.md](NOTICE.md) 为准。

## 1. 版本标识

- 应用名：`DeepSaga`
- 版本：`0.9.1`
- versionCode：`144`
- 包名 / namespace：`io.github.sjfc123.deepsaga`
- 最终版本状态：**自本项目最终版本源代码开源后，将不再进行更新。**
- 本声明中的“更新”指版本号变更、版本说明追加与发布节点。同步性修正仅限上游兼容、构建修复和安全修补，不属于版本更新；不单独变更版本号、不追加版本说明、不写入变更日志。仅在明确要求时记录。

## 2. 包内容

源码包由仓库工作树导出，包含：

- 前端源码：`src/`、构建配置与 `package.json` / `pnpm-lock.yaml`
- Android 源码：`android/`，含 Gradle 配置、Java 源码、资源与图标
- 测试脚本：`scripts/`
- 文档：`README.md`、`NOTICE.md`、`DISCLAIMER.md`、`SOURCE-BACKUP.md`、`PERFORMANCE-AUDIT.md`、`SYSTEM-PROMPT-PIPELINE.md`、`FEATURE-GUIDE.md`
- 许可证：`LICENSE`、`licenses/MIT-DeepSeek.txt`
- 网页图标：`src/assets/favicon.png`、`src/assets/apple-touch-icon.png`、`src/assets/app-icon.png`
- 安卓图标：`mipmap-*` 多密度 PNG、自适应背景层与前景层、`mipmap-anydpi-v26/ic_launcher.xml`
- 内部插图：`src/assets/dafeiyu-icon.png`
- 内置角色头像：`src/assets/builtin-avatars/dafeiyu.webp`、`src/assets/builtin-avatars/whale-girl.webp`
- 二创原图与署名：`assets/fanart/dafeiyu-eat.jpg`、`assets/fanart/whalegirl-full.jpg`、`assets/fanart/SOURCES.md`

包内文件清单以 ZIP 实际内容为准。源码包以 `package.json` 的版本号与 versionCode 标识来源，不写入构建机路径、提交号或签名信息。

### 2.1 二创素材变更

- 已删除 `src/assets/deepseek-whale.svg` 与 `src/assets/builtin-avatars/whale.webp`，项目内不再保留原版鲸鱼插图资源。
- 欢迎页、API Key 设置页改用 `src/assets/dafeiyu-icon.png`。
- 内置「大肥鱼」头像改用 SlimeNull 的 `大肥鱼桌宠 Chubby Whale · 吃饭` 裁切图；作者主页 <https://space.bilibili.com/441842015>。
- 内置「鲸鱼娘」头像改用 ZipZipPipe 的女仆装鲸鱼娘立绘裁切图；作者主页 <https://space.bilibili.com/4168597>。
- 角色原型为「溟月」（上善无形，<https://space.bilibili.com/4456176>）；女仆装与 DeepSeek 元素二创由 ZipZipPipe 完成。内置卡作者入口指向上善无形的 B 站主页，GitHub Pages 图集只作归档索引。
- 图片按 CC BY-NC-SA 4.0 使用：必须署名、禁止商业使用、修改后的图片须以相同协议共享。应用代码的 GPL-3.0 不覆盖图片。完整来源与修改记录见 `assets/fanart/SOURCES.md`。

## 3. 不包含内容

源码包不包含：

- `release.jks`、`debug.keystore`、任何签名文件或签名密码
- 预编译 APK、AAB、网页构建产物 `dist/`
- API Key、聊天记录、角色卡、世界书、记忆、诊断日志或用户数据
- `node_modules/`、Gradle 缓存、IDE 配置、`.env` 或本机路径配置
- 第三方网关凭据、CDN 凭据、发布令牌或自动部署密钥

接收者不得向源码包补入上述内容后再公开分发。

## 4. 构建输入

前端：

```bash
pnpm install
pnpm type
pnpm lint
pnpm build
```

- Node.js 与 pnpm 版本以 `package.json` 的 `engines` 为准。
- 构建产物输出到 `dist/`。
- 网页部署时，`dist/index.html`、`dist/static/js/main.*.js`、`dist/favicon.png` 必须来自同一次构建。

Android：

```bash
cd android
./gradlew assembleRelease
```

- JDK 21。
- Android SDK 需包含与 `compileSdk` 对应的平台、minSdk 29 及对应 build-tools；本次构建环境公网仓库仅提供 android-36，工程以 compileSdk 36、targetSdk 36 编译。
- Gradle 9.7.1、AGP 9.4.0。
- 构建者必须自行提供签名配置。仓库中的示例路径和别名不构成发布凭据。
- 签名配置中的 `keyAlias 'dsreplica'` 是历史签名别名，不是应用品牌。更换别名会使既有签名链失效，是否更换由构建者自行决定。

## 5. 校验项目

发布或分发前，构建者必须核对：

- `aapt2 dump badging`：包名 `io.github.sjfc123.deepsaga`、versionCode `144`、versionName `0.9.1`、application-label `DeepSaga`。
- 启动 Activity：`io.github.sjfc123.deepsaga.MainActivity`。
- APK 内 `ic_launcher.png` 为星空图标，不是上游蓝色鲸鱼。
- `dist/index.html` 标题为 `DeepSaga`，版本 meta 为 `0.9.1`。
- `dist/favicon.png` 与主脚本返回 HTTP 200。
- `pnpm type`、`pnpm lint`、`pnpm build` 通过。
- `pnpm test:system`、`test:roleplay`、`test:story`、`test:auto-backup`、`test:data`、`test:import-attach`、`test:prompt`、`test:memory`、`test:memory-routing`、`test:memory-view`、`test:memory-layers`、`test:groups`、`test:suggestions`、`test:cache`、`test:balance` 通过。
- APK 签名证书指纹与发布记录一致；不一致时不得作为同一应用的升级包分发。

校验结果只证明该次构建的输入与产物，不证明第三方修改版、转载包或非官方渠道产物。

## 6. 迁移与兼容

- 0.9.0 使用独立包名，旧版 `io.github.lijiahua1024.dsreplica` 的数据不会自动迁移。
- 迁移必须通过旧版「导出所有历史对话」再在新版导入完成。
- API Key 不进入备份，迁移后必须重新填写。
- 历史对话 ZIP、单会话包、设定存档和记忆归档保持原格式标识。
- 内部 `replica:` 存储键保持不变，用于读取既有数据。
- 旧包字段缺失、ID 冲突或手工修改导致的格式异常，按单个会话排除并在界面列出标题与原因；其余会话继续导入，不因一个坏条目整体失败。
- 新导出的会话 JSON 带可选 `integrity` 字段（版本、算法、消息数量、内容摘要），导入时先比对消息数量再比对摘要，可识别 JSON 合法但消息被截断或正文被改写的情况；旧包没有该字段时不执行比对，不影响导入。
- 长期记忆新卡写入具体说话人名字；旧卡没有名字字段时按归属和当前玩家/角色名回退显示，数据格式没有新增必填迁移项。

## 7. 交付边界

- 本仓库只提供源代码，不提供预编译 APK、在线服务、代打包、部署指导或技术支持。
- 第三方构建产物由构建者、分发者独立负责。本仓库不为其完整性、签名来源、内置内容、隐私行为或平台合规作担保。
- 数据泄露、违规内容、账号封禁、法律纠纷和经济损失的责任，按构建者、分发者与使用者的实际行为分别归属，不转移给源码作者。
- 本仓库作者不提供任何形式的担保，不承担任何连带法律责任。

## 8. 交接

如由他人接手：

- 以接手方仓库和发布渠道为准。
- 接手方必须保留 GPL-3.0、MIT 与上游署名。
- 接手方必须重新生成并保管签名密钥，不得复用来源不明的签名。
- 接手方必须自行完成设备矩阵、接口网关、安装升级和数据迁移验证。
- 原仓库不承诺交接、不承诺转移发布渠道，也不对后继版本作背书。
