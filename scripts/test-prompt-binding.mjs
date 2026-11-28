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
  setSystemPrompt,
  setSystemPromptBinding,
  setPersonaPromptBinding,
  setDefaultPromptEnabled,
  setBasicRoleplayEnabled,
  setSuppressionPersonaEnabled,
  setSuppressionPersona,
  inheritSystemPromptBinding,
  inheritPersonaPromptBinding,
  freezePromptSourceSessions,
  upsertPromptLock,
  clearPromptLocks,
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

useSettings.setState({
  defaultPromptEnabled: true,
  systemPromptEnabled: false,
  basicRoleplayEnabled: false,
  suppressionPersonaEnabled: false,
})
setSystemPrompt('只填一个字')
state = useSettings.getState()
assert.equal(state.defaultPromptEnabled, false, '手写系统提示词填入任意内容后官方人格必须关闭')
assert.equal(state.systemPromptEnabled, true, '手写身份来源填入后必须恢复注入开关')

setDefaultPromptEnabled(true)
state = useSettings.getState()
assert.equal(state.defaultPromptEnabled, true, '重新开启官方人格后官方开关保持开启')
assert.equal(state.systemPromptEnabled, false, '官方人格开启时手写系统提示词开关必须关闭')
assert.equal(state.suppressionPersonaEnabled, false, '官方人格开启时自定义预设开关必须关闭')
assert.equal(state.basicRoleplayEnabled, false, '官方人格开启时基础扮演开关必须关闭')

setBasicRoleplayEnabled(true)
assert.equal(useSettings.getState().defaultPromptEnabled, false, '开启基础扮演时官方人格必须关闭')
setBasicRoleplayEnabled(false)
assert.equal(useSettings.getState().suppressionPersonaEnabled, false, '关闭基础扮演时依赖它的自定义预设必须关闭')

setSuppressionPersonaEnabled(true)
state = useSettings.getState()
assert.equal(state.basicRoleplayEnabled, true, '启用自定义预设时必须挂到基础扮演模式下')
assert.equal(state.defaultPromptEnabled, false, '启用自定义预设时官方人格必须关闭')

useSettings.setState({
  promptSessionIds: ['source-system'],
  personaSessionIds: ['source-persona'],
})
inheritSystemPromptBinding('source-system', 'new-system')
inheritPersonaPromptBinding('source-persona', 'new-persona')
state = useSettings.getState()
assert.deepEqual(state.promptSessionIds, ['source-system', 'new-system'], '新会话应继承来源会话的系统提示词绑定')
assert.deepEqual(state.personaSessionIds, ['source-persona', 'new-persona'], '新会话应继承来源会话的自定义预设绑定')

inheritSystemPromptBinding('missing-source', 'again-system')
assert.deepEqual(useSettings.getState().promptSessionIds, ['source-system', 'new-system'], '来源会话未绑定时不得凭空追加新会话')

useSettings.setState({ promptSessionIds: null, personaSessionIds: null })
inheritSystemPromptBinding('source-system', 'global-system')
inheritPersonaPromptBinding('source-persona', 'global-persona')
state = useSettings.getState()
assert.equal(state.promptSessionIds, null, '旧版全局继承记录保持 null，不强行展开成显式数组')
assert.equal(state.personaSessionIds, null, '旧版全局继承记录保持 null，不强行展开成显式数组')

useSettings.setState({
  systemPrompt: '冻结后的系统身份',
  suppressionPersona: '冻结后的预设身份',
  systemPromptEnabled: true,
  suppressionPersonaEnabled: true,
  basicRoleplayEnabled: true,
  promptSessionIds: ['locked-system'],
  personaSessionIds: ['locked-persona'],
  promptLocks: {},
})
assert.equal(freezePromptSourceSessions('system'), 1, '关闭系统提示词前必须冻结绑定会话快照')
assert.equal(freezePromptSourceSessions('persona'), 1, '关闭自定义预设前必须冻结绑定会话快照')
state = useSettings.getState()
assert.equal(state.promptLocks['locked-system'].source, 'system', '系统提示词快照必须保留来源类型')
assert.equal(state.promptLocks['locked-system'].text, '冻结后的系统身份', '系统提示词快照必须保留正文')
assert.equal(state.promptLocks['locked-persona'].source, 'persona', '自定义预设快照必须保留来源类型')
assert.equal(state.promptLocks['locked-persona'].text, '冻结后的预设身份', '自定义预设快照必须保留正文')

upsertPromptLock('locked-system', 'system', '更新后的系统身份')
state = useSettings.getState()
assert.equal(state.promptLocks['locked-system'].text, '更新后的系统身份', '重新开启并更新后必须刷新会话快照')
upsertPromptLock('locked-system', 'system', '   ')
assert.equal(
  useSettings.getState().promptLocks['locked-system'].text,
  '更新后的系统身份',
  '空文本不得覆盖既有冻结快照'
)

clearPromptLocks('persona')
state = useSettings.getState()
assert.equal(state.promptLocks['locked-persona'], undefined, '按来源清理时只能移除对应预设快照')
assert.equal(state.promptLocks['locked-system'].source, 'system', '按来源清理时保留另一来源快照')
clearPromptLocks()
assert.deepEqual(useSettings.getState().promptLocks, {}, '复位角色表达设定时清空全部冻结快照')

const root = new URL('../', import.meta.url)
const androidSettings = readFileSync(new URL('src/components/settings/AndroidSettings.tsx', root), 'utf8')

assert.match(androidSettings, /popup === 'promptSessions'/, '系统提示词会话选择弹窗必须保留')
assert.match(androidSettings, /popup === 'personaSessions'/, '自定义预设会话选择弹窗必须存在')
assert.match(androidSettings, /popup === 'promptLockNotice'/, '关闭后旧对话已隔离提示弹窗必须存在')
assert.match(androidSettings, /const toggleSystemPrompt = \(\) =>/, '系统提示词关闭流程必须先冻结旧对话')
assert.match(androidSettings, /const toggleSuppressionPersona = \(\) =>/, '自定义预设关闭流程必须先冻结旧对话')
assert.match(androidSettings, /const toggleBasicRoleplay = \(\) =>/, '基础扮演关闭流程必须先冻结自定义预设旧对话')
assert.match(androidSettings, /const toggleDefaultPrompt = \(\) =>/, '官方人格开启流程必须先冻结自定义身份旧对话')
assert.match(androidSettings, /freezePromptSourceSessions\('system'\)/, '系统提示词冻结入口必须接入设置页')
assert.match(androidSettings, /freezePromptSourceSessions\('persona'\)/, '自定义预设冻结入口必须接入设置页')
assert.match(androidSettings, /const disabled = personaBoundIds\.includes\(session\.id\)/, '系统侧必须置灰预设已选会话')
assert.match(androidSettings, /const disabled = systemBoundIds\.includes\(session\.id\)/, '预设侧必须置灰系统已选会话')
assert.match(androidSettings, /setPersonaPromptBinding\(personaDraftIds \?\? \[\]\)/, '预设弹窗确认必须落盘绑定')
assert.match(androidSettings, /setSystemPromptBinding\(promptDraftIds \?\? \[\]\)/, '系统弹窗确认必须落盘绑定')

const settingsSource = readFileSync(new URL('src/services/settings.ts', root), 'utf8')
assert.match(settingsSource, /personaSessionIds: string\[\] \| null/, '设置类型必须携带预设会话绑定')
assert.match(settingsSource, /personaSessionIds: 'replica:persona-session-ids'/, '预设绑定必须有独立存储键')
assert.match(settingsSource, /promptLocks: PromptLockMap/, '设置类型必须携带会话冻结快照')
assert.match(settingsSource, /promptLocks: 'replica:prompt-locks'/, '冻结快照必须有独立存储键')
assert.match(
  settingsSource,
  /systemPromptEnabled: read\(KEYS\.systemPromptEnabled\) === 'true'/,
  '系统提示词开关必须按持久化值读回，不能被官方人格默认状态强制关闭'
)
assert.match(
  settingsSource,
  /suppressionPersonaEnabled: read\(KEYS\.suppressionPersonaEnabled\) === 'true'/,
  '自定义预设开关必须按持久化值读回，不能被官方人格默认状态强制关闭'
)

console.log('prompt binding regression: ok')
