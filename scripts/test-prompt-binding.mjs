/* ============================================================================
 * 功能区：回归与构建辅助 / test-prompt-binding · 提示词会话绑定
 * 职责：系统提示词与自定义角色扮演预设的同级互斥、双侧置灰与内置助手关闭口径。
 * 分区：01 夹具与固定输入；02 绑定互斥；03 界面接线断言
 * 关联：被测模块 services/settings、components/settings/AndroidSettings；
 *    由 pnpm 脚本直接执行。
 * 导出：无（独立可执行脚本）
 * 边界：只执行本地回归，不写入真实用户数据；Node 环境下持久化读取/写入为空实现。
 * ========================================================================== */

/**
 * 提示词绑定回归：
 * 1. 系统提示词与自定义预设处于同级身份来源，已选会话不能重复绑定；
 * 2. 保存任一侧绑定时，另一侧重复会话自动剔除；
 * 3. 填写或启用自定义预设时，内置 AI 助手提示词自动关闭；
 * 4. Android 选择器为两侧冲突会话提供置灰入口，避免误触。
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const storage = new Map()
globalThis.window = {}
globalThis.localStorage = {
  getItem: (key) => (storage.has(key) ? storage.get(key) : null),
  setItem: (key, value) => storage.set(key, String(value)),
  removeItem: (key) => storage.delete(key),
}

const {
  useSettings,
  setSystemPromptBinding,
  setPersonaPromptBinding,
  setSuppressionPersonaEnabled,
  setSuppressionPersona,
} = await import('../src/services/settings.ts')

useSettings.setState({
  systemPrompt: '系统身份',
  suppressionPersona: '自定义预设',
  suppressionPersonaEnabled: false,
  basicRoleplayEnabled: true,
  defaultPromptEnabled: true,
  promptSessionIds: ['system-a', 'shared'],
  personaSessionIds: ['shared', 'persona-a'],
})

setSystemPromptBinding(['system-a', 'shared'])
let state = useSettings.getState()
assert.deepEqual(state.promptSessionIds, ['system-a'], '系统提示词绑定不得保留预设已选会话')
assert.deepEqual(state.personaSessionIds, ['shared', 'persona-a'], '剔除系统侧重复会话后保留预设会话')

setPersonaPromptBinding(['persona-a', 'shared'])
state = useSettings.getState()
assert.deepEqual(state.personaSessionIds, ['persona-a', 'shared'], '预设绑定应保留已选会话')
assert.deepEqual(state.promptSessionIds, ['system-a'], '预设侧重复会话必须从系统侧剔除')

useSettings.setState({ defaultPromptEnabled: true })
setSuppressionPersonaEnabled(true)
assert.equal(useSettings.getState().defaultPromptEnabled, false, '启用自定义预设时内置助手提示词必须关闭')

useSettings.setState({ defaultPromptEnabled: true })
setSuppressionPersona('  同等级角色扮演预设  ')
assert.equal(useSettings.getState().defaultPromptEnabled, false, '填写自定义预设时内置助手提示词必须关闭')
assert.equal(useSettings.getState().suppressionPersona, '  同等级角色扮演预设  ')

const root = new URL('../', import.meta.url)
const androidSettings = readFileSync(new URL('src/components/settings/AndroidSettings.tsx', root), 'utf8')

assert.match(androidSettings, /popup === 'promptSessions'/, '系统提示词会话选择弹窗必须保留')
assert.match(androidSettings, /popup === 'personaSessions'/, '自定义预设会话选择弹窗必须存在')
assert.match(androidSettings, /const disabled = personaBoundIds\.includes\(session\.id\)/, '系统侧必须置灰预设已选会话')
assert.match(androidSettings, /const disabled = systemBoundIds\.includes\(session\.id\)/, '预设侧必须置灰系统已选会话')
assert.match(androidSettings, /setPersonaPromptBinding\(personaDraftIds \?\? \[\]\)/, '预设弹窗确认必须落盘绑定')
assert.match(androidSettings, /setSystemPromptBinding\(promptDraftIds \?\? \[\]\)/, '系统弹窗确认必须落盘绑定')

const settingsSource = readFileSync(new URL('src/services/settings.ts', root), 'utf8')
assert.match(settingsSource, /personaSessionIds: string\[\] \| null/, '设置类型必须携带预设会话绑定')
assert.match(settingsSource, /personaSessionIds: 'replica:persona-session-ids'/, '预设绑定必须有独立存储键')

console.log('prompt binding regression: ok')
