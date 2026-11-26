# 二创素材来源与许可

本目录保存 DeepSaga 内部插图与内置角色头像使用的社区二创原图。应用代码按 GPL-3.0 发布；本目录图片按 **CC BY-NC-SA 4.0** 单独授权，不自动适用 GPL-3.0。

## 1. 角色来源链

- **原创角色「溟月」**：B 站 UP 主「上善无形」，2025-06-25 发布。蓝色渐变长发、呆毛、鲸类头鳍、蓝色眼睛、大型鲸尾。原始设定不是 DeepSeek 官方形象。
- **女仆装鲸鱼娘**：B 站 UP 主「ZipZipPipe」，2026-04-25 在「溟月」基础上加入 DeepSeek 元素，设计深蓝白色女仆长裙，并使用 GPT Image 2 生成初版。
- **「吃白饭的大肥鱼」人设**：社区在使用与二创中逐渐形成。白饭、摸鱼、傲娇、护食、管用户叫「鱼片」等设定来自社区讨论与模型互动，不属于官方设定。
- **名称来源**：DeepSeek 识图时曾把自家蓝色鲸鱼 Logo 描述为「蓝色大肥鱼」，该称呼随后在社区流传。

角色不是 DeepSeek 官方 mascot，本仓库与 DeepSeek、上善无形、ZipZipPipe 均无隶属或背书关系。

## 2. 本仓库使用的图片

### 2.1 大肥鱼吃饭图

- 文件：`assets/fanart/dafeiyu-eat.jpg`
- 作者：**SlimeNull**
- 作品名：`大肥鱼桌宠 Chubby Whale · 吃饭`
- 来源页：[DeepSeek 鲸鱼娘 · 角色图集](https://iphsiibl.github.io/deepseek-whale-girl-gallery/)
- 图片归档地址：`https://aka.doubaocdn.com/l/65zGW3JYKI`
- 用途：`src/assets/dafeiyu-icon.png`、`src/assets/builtin-avatars/dafeiyu.webp`
- 修改：裁切头部与饭碗、圆形蒙版、256px 缩放、WebP 重编码。未用 AI 重绘人物。

### 2.2 女仆鲸鱼娘立绘

- 文件：`assets/fanart/whalegirl-full.jpg`
- 作者：**ZipZipPipe**；角色原型：**上善无形「溟月」**
- 作品名：`女仆鲸鱼娘`（目前流传最广的原立绘）
- 来源页：[DeepSeek 鲸鱼娘 · 角色图集](https://iphsiibl.github.io/deepseek-whale-girl-gallery/)
- 图片归档地址：`https://aka.doubaocdn.com/l/cn41xXAJMQ`
- 用途：`src/assets/builtin-avatars/whale-girl.webp`
- 修改：白底转透明、裁切上半身、256px 缩放、WebP 重编码。未用 AI 重绘人物。

## 3. 许可与署名

图片整体按 **CC BY-NC-SA 4.0** 使用：

- **署名**：必须标注「上善无形」为角色原型作者、「ZipZipPipe」为女仆装二创作者，以及具体图片作者。
- **非商业**：不得将图片或含图片的衍生作品用于商业目的。免费分发、个人使用不构成商用；应用商店付费、广告、付费会员、代打包收费等属于商用，必须另行取得授权。
- **相同方式共享**：修改后的图片必须以相同协议开放。本仓库已保留原图与修改说明。
- **不得误导**：不得将本仓库或图片表述为 DeepSeek 官方、上善无形官方或 ZipZipPipe 官方发布。

应用代码的 GPL-3.0 与图片的 CC BY-NC-SA 4.0 分别适用。再分发时不得删除本文件、作者署名与许可说明。

## 4. 已移除资源

- 已删除上游蓝色鲸鱼 SVG：`src/assets/deepseek-whale.svg`
- 已删除旧头像源文件：`src/assets/builtin-avatars/whale.webp`
- 已替换欢迎页、API Key 设置页、内置「大肥鱼」头像与内置「鲸鱼娘」头像
- 项目内不再保留原版鲸鱼插图资源
