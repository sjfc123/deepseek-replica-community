# 源码留存说明 · 0.8.65

这份说明跟着源码包一起放，不是发布公告。它只回答四个问题：这是哪个版本、包里有什么、缺了什么、后来的人怎么把它跑起来。

## 版本

- 版本号：0.8.65
- 开发阶段的 versionCode：111
- 覆盖版包名：`io.github.lijiahua1024.dsreplica`
- 并存版包名：`io.github.lijiahua1024.dsreplica.rp`
- 前端版本标记：`dist/index.html` 里的 `application-version=0.8.65`

## 包里有什么

- `src/`：React + TypeScript 前端源码
- `android/`：Android 容器、Java 源码和 Gradle 工程
- `scripts/`、`rspack.config.ts`、`tsconfig.json`：构建与测试脚本
- `package.json`、`pnpm-lock.yaml`：依赖和锁定版本
- `README.md`、`NOTICE.md`、`LICENSE`、本说明：来源、许可和使用边界

## 包里没有什么

- `node_modules/`：按 `pnpm-lock.yaml` 重新安装
- `dist/`：按源码重新构建
- APK、签名文件、`debug.keystore`、`release.jks`
- 打包中间产物、测试演练页、个人备份

这些不是遗漏，是故意不放进源码包。APK 和签名文件由构建者自己生成、自己保管；具体边界写在 README 的“编译、签名与分发”一节，NOTICE 里也有说明。别人转发的 APK 不代表这个仓库，也无法证明没有被改过。

## 跑起来

```bash
pnpm install
pnpm type
pnpm build
```

前端产物输出到 `dist/`。Android 工程用 `android/gradlew` 构建；Gradle 9.7.1、AGP 9.4.0、compileSdk 37 是当前工程配置，环境不一致时自行调整。签名要自己生成，不要把密钥提交进来。

如果只是想看界面，`pnpm dev` 起本地开发服务即可。真正装到设备上、接自己的 API Key、处理系统权限和 ROM 差异，是另一段工作，源码只能把起点交给你。

## 交接

0.8.65 之后不再负责往后的更新。编译、签名与分发由接手的人自行决定，并承担相应责任。这个包的价值是让下一个人不用从零猜请求怎么拼、角色怎么注入、记忆怎么隔离、通话怎么断句，而不是承诺一个长期维护的成品。后面的版本号、发布节奏和分发方式，由接手的人自己决定。
