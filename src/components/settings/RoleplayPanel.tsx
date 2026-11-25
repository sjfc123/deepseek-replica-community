/* ============================================================================
 * 功能区：设置页 / RoleplayPanel 开始
 * 职责：角色卡与世界书面板：单卡启停、卡片编辑、世界书条目、场景与模板。
 * ========================================================================== */

import { useEffect, useMemo, useRef, useState } from 'react'
import { getVisibleMessages } from '../../services/chat/branches.js'
import { startCharacterIntro, useChatStore } from '../../services/chat/store.js'
import {
  BUILTIN_CHARACTER_CARD_TOTAL,
  CHARACTER_CARD_MAX,
  CHARACTER_GENRES,
  CHARACTER_TAG_MAX,
  CHARACTER_TAG_LENGTH,
  PLAY_STYLES,
  PLAY_STYLE_DEFAULT,
  SCENE_FIELDS,
  SCENE_LIMITS,
  WORLDBOOK_AUTHORITIES,
  WORLDBOOK_AUTHORITY_DEFAULT,
  WORLDBOOK_KINDS,
  WORLDBOOK_KIND_DEFAULT,
  WORLDBOOK_WEIGHT_DEFAULT,
  WORLDBOOK_MAX,
  findSessionCharacterCard,
  newRoleplayId,
  normalizeKeywords,
  normalizeTags,
  readAvatarImage,
  sceneHasContent,
  selectWorldbookEntries,
  type CharacterCard,
  type SceneField,
  type WorldbookEntry,
} from '../../services/chat/roleplay.js'
import {
  parseCharacterPayload,
  parseWorldbookPayload,
  readCharacterFile,
} from '../../services/chat/cardFormats.js'
import {
  activateCharacterCard,
  clearScene,
  deleteCharacterCard,
  deleteWorldbookEntry,
  restoreBuiltinCharacterCards,
  saveCharacterCard,
  setCardAvatar,
  saveWorldbookEntry,
  setSceneAutoUpdate,
  setSceneField,
  setRoleplayEnabled,
  setWorldbookChars,
  useSettings,
  WORLDBOOK_BUDGET_DEFAULT,
  WORLDBOOK_BUDGET_MAX,
  WORLDBOOK_BUDGET_MIN,
} from '../../services/settings.js'
import { showToast } from '../base/toastState.js'
import { android, saveAndroidHistory } from '../../app/android.js'
import styles from './RoleplayPanel.module.css'

/** 示例模板：字段与角色卡一一对应，点击后整组填入，用户可继续修改 */
/* -------------------- 功能区：示例卡与字段模板 开始 -------------------- */
const CARD_EXAMPLES: Array<{ label: string; card: Partial<CharacterCard> }> = [
  {
    label: '旧城邻里',
    card: {
      name: '林晚',
      age: '28 岁',
      gender: '女',
      pronouns: '她',
      species: '人类',
      height: '165cm',
      weight: '50kg',
      occupation: '修表铺主',
      residence: '旧城区巷口',
      languages: '普通话，带一点旧城口音',
      favoriteFoods: '巷口牛肉粉，加一个卤蛋',
      dislikedFoods: '香菜',
      favoriteDrinks: '淡茶',
      hobbies: '修旧表、听广播里的老歌',
      dailyRoutine: '十点开门，晚上九点收铺；周三去旧货市场',
      possessions: '一把用旧的螺丝刀、放大镜',
      pet: '无',
      temperament: '话少、稳，遇到不讲理的人会先冷下来',
      values: '手艺、不欠人情',
      petPeeves: '被催婚、被问前段婚姻',
      boundaries: '不谈过去那段婚姻；夜里十点后不接待',
      cooperation: '慢热，不主动推进感情；被追问会转移话题，但会留一个可以继续的细节',
      identity:
        '旧城区巷口开一家修表铺，铺子只有一张工作台。手上常年有机油味，认得这条街上每一块表。',
      relationship: '住对门五年。你搬来那天她借过一把螺丝刀，之后一直没还，也没提。',
      style: '话少，句子短，先说结论再说原因。不主动开玩笑，但接得住别人的玩笑。',
      tics: '说话时用拇指搓表带；被问到私事会先低头看表。',
      greeting: '（把台灯往下压了压，抬头看你）门没锁，进来吧。表又停了？先放这儿，我看看。',
      notes: '不谈过去那段婚姻；不劝人留在旧城；夜里十点后不回铺子。',
    },
  },
  {
    label: '末世同行',
    card: {
      name: '陆沉',
      age: '30 岁',
      gender: '男',
      pronouns: '他',
      species: '人类',
      height: '183cm',
      weight: '76kg',
      occupation: '地铁检修工，现为小队水电负责人',
      residence: '移动营地',
      languages: '普通话，语速偏慢',
      favoriteFoods: '罐头豆子、压缩饼干',
      dislikedFoods: '太甜的东西',
      favoriteDrinks: '白水',
      hobbies: '修设备、看旧地图',
      dailyRoutine: '天亮前查一遍水和电，夜里最后一个睡',
      possessions: '掉漆的水壶、一把活动扳手',
      pet: '无',
      temperament: '克制，先把最坏的结果说完再给方案',
      values: '活着、分工、不丢下队友',
      petPeeves: '浪费水、拿命逞强',
      boundaries: '不美化伤亡；不替队友决定谁该留下',
      cooperation: '末世协作型：给方案、报风险，让对方选，不替对方选',
      identity: '灾变前是地铁检修工。现在负责一支六人小队的水电和路线，左臂有一道旧伤。',
      relationship: '和你搭伙走了两年，分工明确：他找水，你守夜。',
      style: '低声、简短，习惯先报风险再给方案。紧张时会重复对方的话尾。',
      tics: '检查装备时从左到右数一遍；听到异响会先按住你的手腕。',
      greeting: '（把水壶递过来，先拧开盖子闻了一下）今天只剩一半。你喝三口，剩下的路上再说。',
      notes: '不轻易承诺能活到明天；不美化伤亡；不谈灾变前的家人。',
    },
  },
  {
    label: '古风客栈',
    card: {
      name: '沈照',
      age: '二十五六岁',
      gender: '男',
      pronouns: '他',
      species: '人类',
      height: '178cm',
      weight: '65kg',
      occupation: '客栈掌柜',
      residence: '自家客栈',
      languages: '官话，带一点南方口音',
      favoriteFoods: '酱牛肉、热汤面',
      dislikedFoods: '太甜的糕点',
      favoriteDrinks: '酽茶',
      hobbies: '拨算盘、听客人说外面的消息',
      dailyRoutine: '卯时开门，亥时关前院；每月十五对一次总账',
      possessions: '一把旧算盘、两本账册',
      pet: '无',
      temperament: '客气里带分寸，越生气笑得越轻',
      values: '账目清楚、招牌干净',
      petPeeves: '赖账、在店里闹事',
      boundaries: '不让客人进后院东厢；不替人销账',
      cooperation: '谈判型：先给条件，再看对方拿什么换；不轻易翻脸，也不做亏本买卖',
      identity: '客栈掌柜，账算得比刀快。祖父留下这间店，前后院一共九间房。',
      relationship: '你第三次住店，欠下的房钱还挂在账上，他没催。',
      style: '客气里带分寸，敬语用得准，话不说满。被冒犯时会笑，笑得让人心里发凉。',
      tics: '算账时拨算珠；不想答的问题会先给你添茶。',
      greeting: '（拨了一下算珠，抬眼）客官又来。上回的账还在，先坐，茶刚沏。',
      notes: '不谈祖父的死因；不让客人进后院东厢；不赊第二次账。',
    },
  },
  {
    label: '江湖夜雨',
    card: {
      name: '裴七',
      age: '28 岁',
      gender: '男',
      pronouns: '他',
      species: '人类',
      height: '175cm',
      weight: '62kg',
      occupation: '线人，替人跑腿递话',
      residence: '城隍庙檐下',
      languages: '官话，带江湖切口',
      favoriteFoods: '烧饼、卤豆干',
      dislikedFoods: '甜食',
      favoriteDrinks: '凉茶',
      hobbies: '听雨、翻铜钱',
      dailyRoutine: '雨天才出摊，晴天在茶馆后巷等人找',
      possessions: '几枚磨亮的铜钱、半沓寻人启事',
      pet: '无',
      temperament: '懒散，眼睛却一直在看人',
      values: '消息有价、不欠账',
      petPeeves: '被套话、被白嫖消息',
      boundaries: '不接杀人买卖；不卖假消息',
      cooperation: '情报型：每次给线索都带来源和代价，不替对方决定信谁',
      genre: '江湖',
      playStyle: 'mystery',
      identity: '替人跑腿的“线人”，不属任何门派。雨天在城隍庙檐下摆一张小桌，卖消息，也替人递话。',
      relationship: '{{user}} 上个月托他找一个人，定金收了，人还没找到。',
      style: '句子短，爱用反问；收钱前后语气一样，不套近乎。',
      tics: '说话时把铜钱在指间翻来翻去；不想答就抬头看雨。',
      scenario: '入夜，雨没停。城隍庙的灯被风吹得只剩一线，桌上有半张被雨泡软的寻人启事。',
      goal: '在三天内找到 {{user}} 要的人，同时躲开正在城里搜人的捕快。',
      secret: '他要找的人其实已经死了，尸体是他亲手埋的；收定金时他就知道。',
      speechExamples:
        '“消息有价，假消息也有价。你要哪一种？”\n“人没找到。钱我不退，但可以再给你一条线。”',
      greeting:
        '（把铜钱扣在桌上，抬眼看雨）来了。人还没找到，线倒有一条。先说好，这条线比定金贵。',
      notes: '低武、重人情与代价；不动辄拔刀。不写成人内容。',
      systemDirective: '每次给线索都要带一个具体的来源和代价；不替 {{user}} 决定信谁。',
    },
  },
  {
    label: '修仙宗门',
    card: {
      name: '闻溪',
      age: '19 岁',
      gender: '女',
      pronouns: '她',
      species: '人类修士',
      height: '160cm',
      weight: '45kg',
      occupation: '青崖宗外门药庐守炉弟子',
      residence: '青崖宗外门柴房',
      languages: '宗门官话',
      favoriteFoods: '山药粥、烤栗子',
      dislikedFoods: '苦药渣',
      favoriteDrinks: '山泉',
      hobbies: '认药草、抄丹方',
      dailyRoutine: '寅时起炉，戌时封火；每旬去药圃点一次药',
      possessions: '一只旧药囊、半本账册',
      pet: '无',
      temperament: '谨慎，越急越先把规矩说一遍',
      values: '门规、同门、账目对得上',
      petPeeves: '被冤枉、被拿身份压人',
      boundaries: '不拿同门顶罪；不偷换药庐的丹',
      cooperation: '守规矩型：先按门规找办法，实在不行才冒险；不替对方决定叛宗',
      genre: '修仙',
      playStyle: 'adventure',
      identity: '青崖宗外门药庐的守炉弟子，卡在引气三层两年。',
      relationship: '{{user}} 是同一批入门的记名弟子，共用一间柴房，丹药常常分着吃。',
      style: '说话轻，爱把“按规矩”挂嘴边；真着急时会连说两句短句。',
      tics: '紧张时捏药囊；算丹药时先看炉火再开口。',
      scenario: '宗门月底查验药庐，少了一炉固元丹。炉火还温着，账册上却对不上数。',
      goal: '在查验前补齐丹药或缺口的账，保住自己和 {{user}} 的记名资格。',
      secret: '少的那炉丹是她偷偷拿去换了一株续脉草，想给 {{user}} 冲关用。',
      speechExamples: '“按规矩，这炉丹该记你名下。可账对不上。”\n“我不能让你去顶。再想。”',
      greeting: '（守着快熄的炉火，听见脚步才回头）别点灯。账册少了一页，先帮我想。',
      notes: '修行有代价，丹药、灵气、人情都要算；不写无代价突破。',
      systemDirective: '资源、境界与门规必须自洽；不替 {{user}} 决定闯山门或叛宗。',
    },
  },
  {
    label: '都市合租',
    card: {
      name: '周禧',
      age: '27 岁',
      gender: '女',
      pronouns: '她',
      species: '人类',
      height: '163cm',
      weight: '52kg',
      occupation: '社区医院夜班护士',
      residence: '老两居合租',
      languages: '普通话，语速快',
      favoriteFoods: '便利店关东煮、番茄鸡蛋面',
      dislikedFoods: '太甜的饮料',
      favoriteDrinks: '冰美式',
      hobbies: '拼乐高、看医疗剧吐槽',
      dailyRoutine: '晚八点到早八点值班，回家先洗澡再算账',
      possessions: '一串钥匙、排班表、医院门禁卡',
      pet: '无',
      temperament: '直接，先把时间和钱算清',
      values: '独立、账目清楚、不拖累别人',
      petPeeves: '拖欠家务、临时改班',
      boundaries: '不替对方决定买房、辞职或表白',
      cooperation: '现实协作型：把选项、成本和截止时间摆出来，让对方自己选',
      genre: '都市',
      playStyle: 'management',
      identity: '社区医院夜班护士，和 {{user}} 合租一套老两居。',
      relationship: '合租八个月，冰箱贴分工表，谁倒垃圾谁签字。',
      style: '语速快，爱报时间和数字；不耐烦时先说“听我说完”。',
      tics: '下班回家先踢掉鞋；算水电费时把单据按日期排好。',
      scenario: '月底，房东突然说要卖房，给了一个月搬走的期限。合租合同还有四个月。',
      goal: '在一个月内找到能续住的方案，同时不耽误夜班。',
      secret: '她其实存够了首付，但一直没说要买房；她怕 {{user}} 以为她在赶人。',
      speechExamples:
        '“一个月。搬家、找房、押一付三，你算过没有？”\n“我不是要你搬。我是在想，我们能不能不搬。”',
      greeting:
        '（把钥匙丢进玄关的碗里，鞋还没换）房东来过了。一个月，卖房。你先别急着骂，坐下算账。',
      notes: '都市现实向，钱、班表、通勤都要落地；不写霸总、不写成人内容。',
      systemDirective:
        '每次决定都要对应时间、预算或人情成本；不替 {{user}} 做买房、辞职、表白决定。',
    },
  },
  {
    label: '悬疑旧案',
    card: {
      name: '陆见',
      age: '34 岁',
      gender: '男',
      pronouns: '他',
      species: '人类',
      height: '180cm',
      weight: '70kg',
      occupation: '区档案馆夜班管理员，前现场记者',
      residence: '档案馆附近的老小区',
      languages: '普通话，咬字清楚',
      favoriteFoods: '黑咖啡、硬面包',
      dislikedFoods: '甜食',
      favoriteDrinks: '黑咖啡',
      hobbies: '翻旧报纸、整理剪报',
      dailyRoutine: '白天睡觉，闭馆后查档到凌晨',
      possessions: '一双白手套、一支旧手电',
      pet: '无',
      temperament: '谨慎，先确认门锁再看人',
      values: '真相、证人的安全',
      petPeeves: '被催、被逼着下结论',
      boundaries: '不提前揭底；不把证人名字随便交出去',
      cooperation: '悬疑型：每轮只放一条可验证的线索，不替对方推理',
      genre: '悬疑',
      playStyle: 'mystery',
      identity: '区档案馆的夜班管理员，十年前做过一段时间的现场记者。',
      relationship: '{{user}} 是来查一桩旧案的家属；他答应帮忙，但只肯在闭馆后见面。',
      style: '话留一半，先问“你确定要知道”；叙述时间线时极精确。',
      tics: '翻档案前先擦手；紧张时反复确认门有没有锁。',
      scenario: '闭馆后的档案馆，只有一排感应灯亮着。十年前的卷宗少了两页，借阅记录却是空的。',
      goal: '在被人发现之前补上缺失的两页，确认 {{user}} 要的答案到底值不值得挖。',
      secret: '那两页是他十年前亲手抽走的，为了保住一个证人。',
      speechExamples:
        '“卷宗不会自己少页。少页说明有人来过。”\n“我可以给你名字，但你得先想清楚，名字后面还有人。”',
      greeting: '（把最后一盏灯打开，压低声音）门锁了。你要查的那卷，少两页。现在走还来得及。',
      notes: '悬疑推进靠线索与信息差，不靠突然反转；不写血腥细节、不写成人内容。',
      systemDirective: '每轮只放出一条可验证的线索；不提前揭底，不替 {{user}} 下结论。',
    },
  },
  {
    label: '科幻舰员',
    card: {
      name: '伊莱',
      age: '32 岁',
      gender: '男',
      pronouns: '他',
      species: '人类',
      height: '185cm',
      weight: '78kg',
      occupation: '深空补给舰轮机长',
      residence: '灰隼号',
      languages: '通用语，术语准确',
      favoriteFoods: '压缩饼干、罐头肉',
      dislikedFoods: '合成甜味剂',
      favoriteDrinks: '电解质水',
      hobbies: '修旧电路、拆报废仪表',
      dailyRoutine: '每四小时查一次氧和电，睡前听一遍轮机录音',
      possessions: '一把绝缘扳手、一块旧能耗表',
      pet: '无',
      temperament: '冷静，先看数据再看人',
      values: '全舰安全、程序、可验证的结论',
      petPeeves: '没有依据的猜测、临场改流程',
      boundaries: '不拿全舰给个人冒险；不隐瞒资源缺口',
      cooperation: '技术型：给可执行方案和代价，不替对方按按钮',
      genre: '科幻',
      playStyle: 'ensemble',
      identity: '深空补给舰“灰隼号”的轮机长，管全舰的电和氧。',
      relationship: '{{user}} 是刚接任的见习领航员，第一次跑长途航线。',
      style: '术语准，语气平；报告问题先给影响范围再给方案。',
      tics: '说话时看墙上的能耗表；紧张时用指节敲三下金属台面。',
      scenario: '灰隼号在返航途中偏航，备用氧只够四十小时；舰桥和货舱各收到一段来源不明的信号。',
      goal: '在氧气耗尽前查明偏航原因，并把全舰带到最近的补给点。',
      secret: '偏航不是故障，是船长手动改的；货舱里那批“医疗物资”没有登记。',
      speechExamples: '“氧四十小时。先关实验舱，再谈谁去货舱。”\n“我不猜。把信号原始记录给我。”',
      greeting:
        '（盯着能耗表，头也没回）氧四十小时，航向偏了七度。你先说，舰桥那段信号是谁先收到的。',
      notes: '科幻设定要守技术边界，资源与时间可追踪；不写成人内容。',
      systemDirective:
        '所有危机都要有可计算的资源与倒计时；配角各有岗位判断，不无条件服从 {{user}}。',
    },
  },
]

/* -------------------- 功能区：示例卡与字段模板 结束 -------------------- */

/* -------------------- 功能区：空数据结构与字段完整度 开始 -------------------- */
const emptyCard = (name = ''): CharacterCard => ({
  id: newRoleplayId(),
  name,
  age: '',
  gender: '',
  pronouns: '',
  species: '',
  height: '',
  weight: '',
  birthday: '',
  occupation: '',
  residence: '',
  languages: '',
  favoriteFoods: '',
  dislikedFoods: '',
  favoriteDrinks: '',
  hobbies: '',
  dailyRoutine: '',
  possessions: '',
  pet: '',
  temperament: '',
  values: '',
  petPeeves: '',
  boundaries: '',
  cooperation: '',
  identity: '',
  relationship: '',
  style: '',
  tics: '',
  greeting: '',
  notes: '',
  genre: '',
  playStyle: PLAY_STYLE_DEFAULT,
  scenario: '',
  systemDirective: '',
  appearance: '',
  background: '',
  goal: '',
  secret: '',
  speechExamples: '',
  tags: [],
  createdAt: Date.now(),
  updatedAt: Date.now(),
})

const emptyEntry = (): WorldbookEntry => ({
  id: newRoleplayId(),
  title: '',
  keywords: [],
  content: '',
  enabled: true,
  always: false,
  match: 'keyword',
  cardId: '',
  weight: WORLDBOOK_WEIGHT_DEFAULT,
  position: 'context',
  kind: WORLDBOOK_KIND_DEFAULT,
  authority: WORLDBOOK_AUTHORITY_DEFAULT,
  scope: 'recent',
  excludeKeywords: [],
  createdAt: Date.now(),
  updatedAt: Date.now(),
})

type Confirm = { kind: 'card' | 'entry'; id: string; name: string } | null

/** 角色卡字段完整度：名字必填，其余用于判断设定是否够用 */
const CARD_FIELD_KEYS: Array<keyof CharacterCard> = [
  'name',
  'age',
  'gender',
  'pronouns',
  'species',
  'height',
  'weight',
  'birthday',
  'occupation',
  'residence',
  'languages',
  'favoriteFoods',
  'dislikedFoods',
  'favoriteDrinks',
  'hobbies',
  'dailyRoutine',
  'possessions',
  'pet',
  'temperament',
  'values',
  'petPeeves',
  'boundaries',
  'cooperation',
  'identity',
  'relationship',
  'style',
  'tics',
  'greeting',
  'genre',
  'scenario',
  'systemDirective',
  'appearance',
  'background',
  'goal',
  'secret',
  'speechExamples',
  'notes',
]
const CARD_FIELD_TOTAL = CARD_FIELD_KEYS.length

const cardFieldCount = (card: CharacterCard) =>
  CARD_FIELD_KEYS.filter((key) => {
    const value = card[key]
    return typeof value === 'string' && value.trim()
  }).length

const formatDate = (value: number) =>
  value
    ? new Date(value).toLocaleString('zh-CN', {
        month: 'numeric',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '尚未填写'

/* -------------------- 功能区：空数据结构与字段完整度 结束 -------------------- */

/* -------------------- 功能区：状态绑定、派生数据与筛选 开始 -------------------- */
export function RoleplayPanel() {
  const cards = useSettings((state) => state.characterCards)
  const activeCharacterId = useSettings((state) => state.activeCharacterId)
  const roleplayEnabled = useSettings((state) => state.roleplayEnabled)
  const cardAvatars = useSettings((state) => state.cardAvatars)
  const worldbook = useSettings((state) => state.worldbook)
  const worldbookChars = useSettings((state) => state.worldbookChars)
  const worldbookInject = useSettings((state) => state.worldbookInject)
  const scene = useSettings((state) => state.scene)
  const sceneAutoUpdate = useSettings((state) => state.sceneAutoUpdate)
  const characterName = useSettings((state) => state.characterName)
  const activeId = useChatStore((state) => state.activeId)
  const sessionCache = useChatStore((state) => state.sessionCache)

  const [cardDraft, setCardDraft] = useState<CharacterCard | null>(null)
  const [entryDraft, setEntryDraft] = useState<WorldbookEntry | null>(null)
  const [keywordDraft, setKeywordDraft] = useState('')
  const [excludeDraft, setExcludeDraft] = useState('')
  const [sceneDraft, setSceneDraft] = useState(scene)
  const [confirm, setConfirm] = useState<Confirm>(null)
  const [cardQuery, setCardQuery] = useState('')
  const [avatarBusy, setAvatarBusy] = useState(false)
  const [avatarDraft, setAvatarDraft] = useState<string | null>(null)
  const [tagDraft, setTagDraft] = useState('')
  const [tagFilter, setTagFilter] = useState('')
  /** 分区切换：三块内容各自独立，进页面先看角色卡 */
  const [panelTab, setPanelTab] = useState<'cards' | 'worldbook' | 'scene'>('cards')
  const [entryQuery, setEntryQuery] = useState('')
  const [entryKindFilter, setEntryKindFilter] = useState<'all' | WorldbookEntry['kind']>('all')
  const [collapsedEntryKinds, setCollapsedEntryKinds] = useState<WorldbookEntry['kind'][]>([])
  const [collapsedCards, setCollapsedCards] = useState<string[]>([])
  const [cardSections, setCardSections] = useState({
    basic: true,
    body: true,
    character: true,
    story: true,
  })
  const [budgetDraft, setBudgetDraft] = useState(String(worldbookChars))
  const [cardImporting, setCardImporting] = useState(false)
  const avatarInput = useRef<HTMLInputElement>(null)
  const cardFileInput = useRef<HTMLInputElement>(null)
  const entryFileInput = useRef<HTMLInputElement>(null)

  const activeSession = activeId ? sessionCache[activeId] : undefined
  const boundCard = findSessionCharacterCard(cards, activeSession)
  const activeCard = cards.find((card) => card.id === activeCharacterId)
  const globalRoleplayOn = roleplayEnabled && Boolean(activeCard)
  /** 全局开关只决定新会话；已经绑定角色的会话继续沿用该卡 */
  const previewCard = boundCard ?? (roleplayEnabled ? activeCard : undefined)
  const roleplayOn = Boolean(previewCard)
  const isNewDraft = Boolean(cardDraft && !cards.some((card) => card.id === cardDraft.id))
  const { recentText, sessionText } = useMemo(() => {
    if (!activeSession) {
      return { recentText: '', sessionText: '' }
    }
    const messages = getVisibleMessages(activeSession)
    const plain = (message: (typeof messages)[number]) => {
      if (message.role === 'user') {
        return message.content
      }
      if (message.role !== 'assistant') {
        return ''
      }
      return message.blocks
        .filter((block): block is { type: 'text'; text: string } => block.type === 'text')
        .map((block) => block.text)
        .join('')
    }
    return {
      recentText: messages.slice(-5).map(plain).filter(Boolean).join('\n'),
      sessionText: messages.map(plain).filter(Boolean).join('\n'),
    }
  }, [activeSession])
  const hitEntries = useMemo(
    () =>
      roleplayOn && worldbookInject
        ? selectWorldbookEntries(
            worldbook,
            recentText,
            undefined,
            worldbookChars,
            previewCard?.id ?? null,
            sessionText
          )
        : [],
    [
      worldbook,
      recentText,
      sessionText,
      previewCard?.id,
      worldbookChars,
      worldbookInject,
      roleplayOn,
    ]
  )
  const entryNeedle = entryQuery.trim().toLowerCase()
  const filteredEntries = worldbook.filter(
    (entry) =>
      (entryKindFilter === 'all' || entry.kind === entryKindFilter) &&
      (!entryNeedle ||
        [entry.title, entry.content, ...entry.keywords, ...entry.excludeKeywords]
          .join('\n')
          .toLowerCase()
          .includes(entryNeedle))
  )
  // 分类分组只影响展示顺序与折叠，不改变命中、启用和注入逻辑。
  const entryGroups = WORLDBOOK_KINDS.map((kind) => ({
    ...kind,
    entries: filteredEntries.filter((entry) => entry.kind === kind.key),
  })).filter((group) => group.entries.length > 0)
  const allEntryGroupsOpen =
    entryGroups.length > 0 &&
    entryGroups.every((group) => !collapsedEntryKinds.includes(group.key))
  const toggleEntryKind = (kind: WorldbookEntry['kind']) =>
    setCollapsedEntryKinds((current) =>
      current.includes(kind) ? current.filter((item) => item !== kind) : [...current, kind]
    )
  const toggleCardCollapsed = (id: string) =>
    setCollapsedCards((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id]
    )
  const toggleCardSection = (key: keyof typeof cardSections) =>
    setCardSections((current) => ({ ...current, [key]: !current[key] }))
  const enabledEntries = worldbook.filter((entry) => entry.enabled).length
  const alwaysEntries =
    roleplayOn && worldbookInject
      ? worldbook.filter((entry) => entry.enabled && entry.always).length
      : 0
  const sceneCount = SCENE_FIELDS.filter(({ key }) => scene[key].trim()).length
  // 标签清单按使用次数排序，供顶部筛选行展示
  const tagList = useMemo(() => {
    const counts = new Map<string, number>()
    for (const card of cards) {
      for (const tag of card.tags) {
        counts.set(tag, (counts.get(tag) ?? 0) + 1)
      }
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh'))
      .map(([tag, count]) => ({ tag, count }))
  }, [cards])
  const visibleCards = useMemo(() => {
    const query = cardQuery.trim().toLowerCase()
    return cards.filter((card) => {
      if (tagFilter && !card.tags.includes(tagFilter)) {
        return false
      }
      if (!query) {
        return true
      }
      return [
        card.name,
        card.age,
        card.gender,
        card.pronouns,
        card.species,
        card.height,
        card.weight,
        card.occupation,
        card.residence,
        card.languages,
        card.genre,
        card.identity,
        card.appearance,
        card.temperament,
        card.values,
        card.petPeeves,
        card.boundaries,
        card.cooperation,
        card.relationship,
        card.style,
        card.tics,
        card.favoriteFoods,
        card.dislikedFoods,
        card.hobbies,
        card.dailyRoutine,
        card.scenario,
        card.background,
        card.systemDirective,
        card.notes,
        card.genre,
        ...card.tags,
      ]
        .join('\n')
        .toLowerCase()
        .includes(query)
    })
  }, [cards, cardQuery, tagFilter])

  useEffect(() => {
    setSceneDraft(scene)
  }, [scene])

  useEffect(() => {
    setBudgetDraft(String(worldbookChars))
  }, [worldbookChars])

  /* -------------------- 功能区：状态绑定、派生数据与筛选 结束 -------------------- */

  /* -------------------- 功能区：卡片、世界书与导入导出操作 开始 -------------------- */
  const applyBudget = (value: number) => {
    const next = Math.min(WORLDBOOK_BUDGET_MAX, Math.max(WORLDBOOK_BUDGET_MIN, Math.round(value)))
    setWorldbookChars(next)
    setBudgetDraft(String(next))
  }

  const startEditCard = (card: CharacterCard) => {
    setCardDraft({ ...card })
    setTagDraft(card.tags.join('、'))
    setAvatarDraft(cardAvatars[card.id] ?? null)
    setEntryDraft(null)
  }

  const saveCardDraft = () => {
    if (!cardDraft) {
      return
    }
    const name = cardDraft.name.trim()
    if (!name) {
      showToast({ key: 'roleplayNeedName', type: 'error' })
      return
    }
    const saved = { ...cardDraft, name, tags: normalizeTags(tagDraft), updatedAt: Date.now() }
    if (!saveCharacterCard(saved)) {
      showToast({ key: 'roleplayStorageFailed', type: 'error' })
      return
    }
    if (!setCardAvatar(saved.id, avatarDraft)) {
      showToast({ key: 'roleplayStorageFailed', type: 'error' })
      return
    }
    setCardDraft(null)
    setAvatarDraft(null)
    setTagDraft('')
    showToast({ key: 'roleplayCardSaved', params: { name } })
  }

  const useCard = (card: CharacterCard) => {
    activateCharacterCard(card.id)
    const introSession = startCharacterIntro(card)
    showToast({
      key: introSession ? 'roleplayIntroStarted' : 'roleplaySwitched',
      params: { name: card.name },
    })
  }

  /** 关闭全局开关：只影响尚未绑定人物的新会话；已绑定会话继续沿用该卡 */
  const closeRoleplay = (card: CharacterCard) => {
    setRoleplayEnabled(false)
    showToast({ key: 'roleplayClosed', params: { name: card.name } })
  }

  /** 复制一张卡：沿用头像与设定，换新 id 与名字后缀，方便在同一原型上分叉 */
  const duplicateCard = (card: CharacterCard) => {
    if (cards.length >= CHARACTER_CARD_MAX) {
      showToast({ key: 'roleplayCardLimit', type: 'error', params: { max: CHARACTER_CARD_MAX } })
      return
    }
    const copy: CharacterCard = {
      ...card,
      id: newRoleplayId(),
      name: `${card.name} 副本`.slice(0, 30),
      builtin: false,
      source: undefined,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    if (!saveCharacterCard(copy)) {
      showToast({ key: 'roleplayStorageFailed', type: 'error' })
      return
    }
    const sourceAvatar = cardAvatars[card.id]
    if (sourceAvatar) {
      setCardAvatar(copy.id, sourceAvatar)
    }
    showToast({ key: 'roleplayCardCopied', params: { name: copy.name } })
  }

  /** 头像选择：读取后压缩为 256 正方形 JPEG，写回草稿，保存时才落盘 */
  const handleAvatarPick = async (file: File | undefined) => {
    if (!file) {
      return
    }
    setAvatarBusy(true)
    try {
      const avatar = await readAvatarImage(file)
      setAvatarDraft(avatar)
      showToast({ key: 'roleplayAvatarUpdated' })
    } catch (error) {
      showToast({
        key: 'roleplayAvatarFailed',
        type: 'error',
        params: { reason: error instanceof Error ? error.message : String(error) },
      })
    } finally {
      setAvatarBusy(false)
    }
  }

  const startEditEntry = (entry: WorldbookEntry) => {
    setEntryDraft({ ...entry })
    setKeywordDraft(entry.keywords.join('，'))
    setExcludeDraft(entry.excludeKeywords.join('，'))
    setCardDraft(null)
    setAvatarDraft(null)
    setTagDraft('')
  }

  const saveEntryDraft = () => {
    if (!entryDraft) {
      return
    }
    const title = entryDraft.title.trim()
    const content = entryDraft.content.trim()
    const keywords = normalizeKeywords(keywordDraft)
    const excludeKeywords = normalizeKeywords(excludeDraft)
    if (!title || !content) {
      showToast({ key: 'roleplayEntryFields', type: 'error' })
      return
    }
    const duplicate = worldbook.find(
      (entry) =>
        entry.id !== entryDraft.id &&
        entry.cardId === entryDraft.cardId &&
        entry.kind === entryDraft.kind &&
        entry.title.trim() === title &&
        entry.content.trim() === content
    )
    if (duplicate) {
      showToast({ key: 'roleplayEntryDuplicate', type: 'error' })
      return
    }
    if (
      !saveWorldbookEntry({
        ...entryDraft,
        title,
        content,
        keywords,
        excludeKeywords,
        updatedAt: Date.now(),
      })
    ) {
      showToast({ key: 'roleplayStorageFailed', type: 'error' })
      return
    }
    setEntryDraft(null)
    showToast({ key: 'roleplayEntrySaved', params: { name: title } })
  }

  const restoreBuiltinCards = () => {
    const added = restoreBuiltinCharacterCards()
    if (added < 0) {
      showToast({ key: 'roleplayStorageFailed', type: 'error' })
      return
    }
    if (added === 0) {
      showToast({ key: 'roleplayBuiltinPresent' })
      return
    }
    showToast({ key: 'roleplayBuiltinRestored', params: { count: added } })
  }

  const doDelete = () => {
    if (!confirm) {
      return
    }
    if (confirm.kind === 'card') {
      deleteCharacterCard(confirm.id)
      if (activeCharacterId === confirm.id) {
        activateCharacterCard(null)
      }
    } else {
      deleteWorldbookEntry(confirm.id)
    }
    showToast({ key: 'roleplayDeleted', params: { name: confirm.name } })
    setConfirm(null)
  }

  /** 世界书导出：整本打包成 JSON，换机或分享设定时单独迁移 */
  const exportWorldbook = async () => {
    const payload = {
      format: 'deepseek-replica-worldbook',
      version: 1,
      exportedAt: Date.now(),
      entries: worldbook,
    }
    const name = `deepseek_worldbook-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}-${worldbook.length}entries.json`
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
    try {
      if (android) {
        const saved = await saveAndroidHistory(name, blob)
        showToast(
          saved
            ? { key: 'roleplayWorldbookExported', params: { name } }
            : { key: 'roleplayWorldbookExportCanceled' }
        )
        return
      }
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = name
      link.click()
      window.setTimeout(() => URL.revokeObjectURL(url), 10_000)
      showToast({ key: 'roleplayWorldbookExported', params: { name } })
    } catch {
      showToast({ key: 'roleplayStorageFailed', type: 'error' })
    }
  }

  /** 角色卡导入：JSON / PNG（Character Card V2、V3、TavernAI），随卡世界书一并写入 */
  const importCharacter = async (file: File) => {
    setCardImporting(true)
    try {
      const payload = await readCharacterFile(file)
      if (!payload) {
        showToast({ key: 'roleplayCharacterBadFile', type: 'error' })
        return
      }
      const incoming = parseCharacterPayload(payload)
      if (incoming.length === 0) {
        showToast({ key: 'roleplayCharacterBadFile', type: 'error' })
        return
      }
      const existing = useSettings.getState().characterCards
      const signatures = new Set(existing.map((card) => `${card.name}\n${card.identity}`))
      const room = Math.max(0, CHARACTER_CARD_MAX - existing.length)
      let avatar = ''
      if (
        incoming.length === 1 &&
        (file.type === 'image/png' || file.name.toLowerCase().endsWith('.png'))
      ) {
        try {
          avatar = await readAvatarImage(file)
        } catch {
          avatar = ''
        }
      }
      let added = 0
      let skipped = 0
      let entries = 0
      let avatarAdded = 0
      for (const item of incoming) {
        const signature = `${item.card.name}\n${item.card.identity}`
        if (signatures.has(signature) || added >= room) {
          skipped++
          continue
        }
        if (!saveCharacterCard(item.card)) {
          skipped++
          continue
        }
        signatures.add(signature)
        added++
        if (avatar && avatarAdded === 0 && setCardAvatar(item.card.id, avatar)) {
          avatarAdded++
        }
        for (const entry of item.worldbook) {
          if (useSettings.getState().worldbook.length >= WORLDBOOK_MAX) {
            continue
          }
          if (saveWorldbookEntry({ ...entry, cardId: item.card.id })) {
            entries++
          }
        }
      }
      showToast({
        key: 'roleplayCharacterImported',
        params: { added, skipped, entries, avatars: avatarAdded },
        type: skipped > 0 ? 'error' : undefined,
      })
    } catch {
      showToast({ key: 'roleplayCharacterBadFile', type: 'error' })
    } finally {
      setCardImporting(false)
    }
  }

  /** 世界书导入：兼容本应用、SillyTavern world info 与角色卡 character_book */
  const importWorldbook = async (file: File) => {
    try {
      const parsed = await readCharacterFile(file)
      const incoming = parseWorldbookPayload(parsed)
      if (incoming.length === 0) {
        showToast({ key: 'roleplayWorldbookBadFile', type: 'error' })
        return
      }
      const existing = new Set(worldbook.map((entry) => entry.id))
      const room = Math.max(0, WORLDBOOK_MAX - worldbook.length)
      let added = 0
      let updated = 0
      let skipped = 0
      for (const entry of incoming) {
        const known = existing.has(entry.id)
        if (!known && added >= room) {
          skipped++
          continue
        }
        if (!saveWorldbookEntry(entry)) {
          skipped++
          continue
        }
        if (known) {
          updated++
        } else {
          existing.add(entry.id)
          added++
        }
      }
      showToast({
        key: 'roleplayWorldbookImported',
        params: { added, updated, skipped },
        type: skipped > 0 ? 'error' : undefined,
      })
    } catch {
      showToast({ key: 'roleplayWorldbookBadFile', type: 'error' })
    }
  }

  /**
   * 角色卡编辑器：编辑现有卡时渲染在卡片原位置，新建卡时渲染在列表上方。
   * 头部提供头像上传与八套示例，字段留空则不参与注入。
   */
  /* -------------------- 功能区：卡片、世界书与导入导出操作 结束 -------------------- */

  /* -------------------- 功能区：角色卡编辑器 开始 -------------------- */
  const renderCardEditor = () => {
    if (!cardDraft) {
      return null
    }
    const editingExisting = cards.some((card) => card.id === cardDraft.id)
    return (
      <div className={styles.editor}>
        <div className={styles.editorHead}>
          <strong>{editingExisting ? '编辑角色卡' : '新建角色卡'}</strong>
          <span>
            姓名必填。年龄、性别、第三人称代词和种族建议先填，避免人称和身份漂移；正文自称固定用「我」，代词只用于他人转述。剩余字段留空不注入，越具体越稳定。
          </span>
          <span className={styles.sourceLine}>
            字段支持 {'${char_name}'} 与 {'${user_name}'} 占位符，发送时替换为角色名和账户名。
          </span>
          {cardDraft.builtin && cardDraft.source ? (
            <span className={styles.sourceLine}>来源：{cardDraft.source}</span>
          ) : null}
        </div>
        <div className={styles.avatarEdit}>
          <span className={styles.avatarPreview} data-empty={avatarDraft ? undefined : ''}>
            {avatarDraft ? (
              <img src={avatarDraft} alt={`${cardDraft.name || '角色'}的头像`} />
            ) : (
              Array.from(cardDraft.name)[0] || '?'
            )}
          </span>
          <div className={styles.avatarCopy}>
            <strong>头像</strong>
            <small>
              选择图片后自动居中裁切为正方形并压缩至
              256px，仅保存在本机；开启头像显示后同步用于聊天。
            </small>
          </div>
          <div className={styles.avatarButtons}>
            <button
              type="button"
              className={styles.ghostButton}
              disabled={avatarBusy}
              onClick={() => avatarInput.current?.click()}
            >
              {avatarBusy ? '处理中…' : avatarDraft ? '更换图片' : '选择图片'}
            </button>
            {avatarDraft ? (
              <button
                type="button"
                className={styles.linkButton}
                onClick={() => setAvatarDraft(null)}
              >
                移除
              </button>
            ) : null}
          </div>
          <input
            ref={avatarInput}
            hidden
            type="file"
            accept="image/png,image/jpeg,image/webp"
            onChange={(event) => {
              const file = event.target.files?.[0]
              event.target.value = ''
              void handleAvatarPick(file)
            }}
          />
        </div>
        <div className={styles.exampleRow}>
          <span>可载入示例模板：</span>
          {CARD_EXAMPLES.map((example) => (
            <button key={example.label} type="button" onClick={() => applyExample(example.label)}>
              {example.label}
            </button>
          ))}
        </div>
        <datalist id="rp-genre-options">
          {CHARACTER_GENRES.map((genre) => (
            <option key={genre} value={genre} />
          ))}
        </datalist>
        <div className={styles.fieldGrid}>
          <div className={styles.fieldGroup}>
            <button
              type="button"
              className={styles.fieldGroupToggle}
              aria-expanded={cardSections.basic}
              onClick={() => toggleCardSection('basic')}
            >
              <strong>基本档案</strong>
              <i>{cardSections.basic ? '收起' : '展开'}</i>
            </button>
            <span>
              年龄、性别、第三人称代词和种族是硬事实，写清后不会随对话漂移；正文写自己一律用「我」，代词只用于别人转述。不知道的项留空，不要临时补。
            </span>
          </div>
          {cardSections.basic ? (
            <>
          <label>
            <span>姓名 *</span>
            <input
              value={cardDraft.name}
              maxLength={30}
              placeholder="对话中使用的称呼"
              onChange={(event) => setCardDraft({ ...cardDraft, name: event.target.value })}
            />
          </label>
          <label>
            <span>年龄</span>
            <input
              value={cardDraft.age}
              maxLength={80}
              placeholder="24 / 外表 22，实际 300 / 不详"
              onChange={(event) => setCardDraft({ ...cardDraft, age: event.target.value })}
            />
          </label>
          <label>
            <span>性别</span>
            <input
              value={cardDraft.gender}
              maxLength={40}
              placeholder="女 / 男 / 非二元 / 无性别 / 可变"
              onChange={(event) => setCardDraft({ ...cardDraft, gender: event.target.value })}
            />
          </label>
          <label>
            <span>第三人称代词</span>
            <input
              value={cardDraft.pronouns}
              maxLength={20}
              placeholder="她 / 他 / ta（只用于他人转述）"
              onChange={(event) => setCardDraft({ ...cardDraft, pronouns: event.target.value })}
            />
          </label>
          <label>
            <span>种族</span>
            <input
              value={cardDraft.species}
              maxLength={40}
              placeholder="人类 / 妖 / 灵体 / 机械 / 混血"
              onChange={(event) => setCardDraft({ ...cardDraft, species: event.target.value })}
            />
          </label>
          <label>
            <span>生日</span>
            <input
              value={cardDraft.birthday}
              maxLength={40}
              placeholder="3 月 17 日 / 不详 / 捡到的那天"
              onChange={(event) => setCardDraft({ ...cardDraft, birthday: event.target.value })}
            />
          </label>
          <label>
            <span>职业</span>
            <input
              value={cardDraft.occupation}
              placeholder="夜班店员 / 剑冢守冢人 / 学生"
              onChange={(event) => setCardDraft({ ...cardDraft, occupation: event.target.value })}
            />
          </label>
          <label>
            <span>居住地</span>
            <input
              value={cardDraft.residence}
              placeholder="旧城巷口 / 宗门后山 / 终端里"
              onChange={(event) => setCardDraft({ ...cardDraft, residence: event.target.value })}
            />
          </label>
          <label>
            <span>语言与口音</span>
            <input
              value={cardDraft.languages}
              placeholder="普通话，带一点江城口音"
              onChange={(event) => setCardDraft({ ...cardDraft, languages: event.target.value })}
            />
          </label>
          <label>
            <span>题材（可自由填写）</span>
            <input
              list="rp-genre-options"
              value={cardDraft.genre}
              placeholder="例如：江湖、修仙、都市、悬疑"
              onChange={(event) => setCardDraft({ ...cardDraft, genre: event.target.value })}
            />
          </label>
            </>
          ) : null}

          <div className={styles.fieldGroup}>
            <button
              type="button"
              className={styles.fieldGroupToggle}
              aria-expanded={cardSections.body}
              onClick={() => toggleCardSection('body')}
            >
              <strong>身体与生活</strong>
              <i>{cardSections.body ? '收起' : '展开'}</i>
            </button>
            <span>
              把能被看见、吃到、摸到的东西写具体；这些细节决定角色是“活着”还是只在等人回复。
            </span>
          </div>
          {cardSections.body ? (
            <>
          <label>
            <span>身高</span>
            <input
              value={cardDraft.height}
              maxLength={40}
              placeholder="165cm / 高个，约 182cm / 可缩进一只碗"
              onChange={(event) => setCardDraft({ ...cardDraft, height: event.target.value })}
            />
          </label>
          <label>
            <span>体重</span>
            <input
              value={cardDraft.weight}
              maxLength={40}
              placeholder="50kg / 清瘦 / 问就是浮力"
              onChange={(event) => setCardDraft({ ...cardDraft, weight: event.target.value })}
            />
          </label>
          <label className={styles.wide}>
            <span>外貌与细节</span>
            <textarea
              rows={2}
              value={cardDraft.appearance}
              placeholder="脸、发型、肤色、常穿的衣服、旧伤、声音、气味；身高体重不在这里重复"
              onChange={(event) => setCardDraft({ ...cardDraft, appearance: event.target.value })}
            />
          </label>
          <label>
            <span>喜欢的食物</span>
            <input
              value={cardDraft.favoriteFoods}
              placeholder="巷口牛肉粉、白米饭、小鱼干"
              onChange={(event) =>
                setCardDraft({ ...cardDraft, favoriteFoods: event.target.value })
              }
            />
          </label>
          <label>
            <span>讨厌的食物</span>
            <input
              value={cardDraft.dislikedFoods}
              placeholder="香菜、太甜的、隔夜饭"
              onChange={(event) =>
                setCardDraft({ ...cardDraft, dislikedFoods: event.target.value })
              }
            />
          </label>
          <label>
            <span>常喝的</span>
            <input
              value={cardDraft.favoriteDrinks}
              placeholder="冷咖啡、粗茶、牛奶"
              onChange={(event) =>
                setCardDraft({ ...cardDraft, favoriteDrinks: event.target.value })
              }
            />
          </label>
          <label>
            <span>兴趣</span>
            <input
              value={cardDraft.hobbies}
              placeholder="修旧表、听雨、拍老建筑"
              onChange={(event) => setCardDraft({ ...cardDraft, hobbies: event.target.value })}
            />
          </label>
          <label className={styles.wide}>
            <span>日常作息</span>
            <textarea
              rows={2}
              value={cardDraft.dailyRoutine}
              placeholder="几点起、几点睡、白天在哪、饭点做什么；没有剧情作用的小习惯最能让角色落地"
              onChange={(event) => setCardDraft({ ...cardDraft, dailyRoutine: event.target.value })}
            />
          </label>
          <label>
            <span>随身物</span>
            <input
              value={cardDraft.possessions}
              placeholder="旧表、卷尺、一枚磨亮的铜钱"
              onChange={(event) => setCardDraft({ ...cardDraft, possessions: event.target.value })}
            />
          </label>
          <label>
            <span>宠物</span>
            <input
              value={cardDraft.pet}
              placeholder="无 / 一只叫年糕的橘猫"
              onChange={(event) => setCardDraft({ ...cardDraft, pet: event.target.value })}
            />
          </label>
            </>
          ) : null}

          <div className={styles.fieldGroup}>
            <button
              type="button"
              className={styles.fieldGroupToggle}
              aria-expanded={cardSections.character}
              onClick={() => toggleCardSection('character')}
            >
              <strong>性格与边界</strong>
              <i>{cardSections.character ? '收起' : '展开'}</i>
            </button>
            <span>
              性格不是标签堆叠，是压力下的选择；雷点和底线写具体，角色才不会为了配合而丢掉自己。
            </span>
          </div>
          {cardSections.character ? (
            <>
          <label className={styles.wide}>
            <span>性格底色</span>
            <textarea
              rows={2}
              value={cardDraft.temperament}
              placeholder="平时怎样，被逼到墙角会怎样；核心欲望、矛盾点、对亲近和冲突的反应"
              onChange={(event) => setCardDraft({ ...cardDraft, temperament: event.target.value })}
            />
          </label>
          <label className={styles.wide}>
            <span>价值观</span>
            <textarea
              rows={2}
              value={cardDraft.values}
              placeholder="最看重什么、为什么不肯让步；遇到冲突时先保什么、后放弃什么"
              onChange={(event) => setCardDraft({ ...cardDraft, values: event.target.value })}
            />
          </label>
          <label>
            <span>雷点</span>
            <input
              value={cardDraft.petPeeves}
              placeholder="被说胖、被替死去的弟兄做主、被催婚"
              onChange={(event) => setCardDraft({ ...cardDraft, petPeeves: event.target.value })}
            />
          </label>
          <label>
            <span>底线</span>
            <input
              value={cardDraft.boundaries}
              placeholder="不接杀人买卖、不写成人内容、不替对方做重大决定"
              onChange={(event) => setCardDraft({ ...cardDraft, boundaries: event.target.value })}
            />
          </label>
          <label className={styles.wide}>
            <span>配合方式</span>
            <textarea
              rows={2}
              value={cardDraft.cooperation}
              placeholder="希望怎样推进场景；可以拒绝、犹豫或谈条件，但每轮都要留一个可继续的落点"
              onChange={(event) => setCardDraft({ ...cardDraft, cooperation: event.target.value })}
            />
          </label>
            </>
          ) : null}

          <div className={styles.fieldGroup}>
            <button
              type="button"
              className={styles.fieldGroupToggle}
              aria-expanded={cardSections.story}
              onClick={() => toggleCardSection('story')}
            >
              <strong>剧情与表达</strong>
              <i>{cardSections.story ? '收起' : '展开'}</i>
            </button>
            <span>
              这一段决定这场戏怎么开始、怎么推进、哪些事不到时候不能说；越具体，越不容易 OOC。
            </span>
          </div>
          {cardSections.story ? (
            <>
          <label className={styles.wide}>
            <span>身份与自我认知</span>
            <textarea
              rows={3}
              value={cardDraft.identity}
              placeholder="职业之外的自我认知、社会位置、别人怎么看她；年龄、性别、身高不在这里重复"
              onChange={(event) => setCardDraft({ ...cardDraft, identity: event.target.value })}
            />
          </label>
          <label className={styles.wide}>
            <span>与账户角色的关系</span>
            <textarea
              rows={2}
              value={cardDraft.relationship}
              placeholder="怎么认识、认识多久、现在算什么、边界在哪；关系会变化时写清起点与可能走向"
              onChange={(event) => setCardDraft({ ...cardDraft, relationship: event.target.value })}
            />
          </label>
          <label>
            <span>说话风格</span>
            <input
              value={cardDraft.style}
              placeholder="话量、句长、语气强弱、用词习惯"
              onChange={(event) => setCardDraft({ ...cardDraft, style: event.target.value })}
            />
          </label>
          <label>
            <span>小习惯</span>
            <input
              value={cardDraft.tics}
              placeholder="紧张时捏衣角，开口前先叹气"
              onChange={(event) => setCardDraft({ ...cardDraft, tics: event.target.value })}
            />
          </label>
          <label className={styles.wide}>
            <span>玩法（决定推进重心）</span>
            <select
              value={cardDraft.playStyle}
              onChange={(event) =>
                setCardDraft({
                  ...cardDraft,
                  playStyle: event.target.value as CharacterCard['playStyle'],
                })
              }
            >
              {PLAY_STYLES.map((style) => (
                <option key={style.key} value={style.key}>
                  {style.label} · {style.hint}
                </option>
              ))}
            </select>
          </label>
          <label className={styles.wide}>
            <span>情景设定（这场戏开始前的局面）</span>
            <textarea
              rows={4}
              value={cardDraft.scenario}
              placeholder="时间、地点、正在发生的事、对方为什么在这里；动态变化请写入场景"
              onChange={(event) => setCardDraft({ ...cardDraft, scenario: event.target.value })}
            />
          </label>
          <label className={styles.wide}>
            <span>过往经历</span>
            <textarea
              rows={3}
              value={cardDraft.background}
              placeholder="塑造现在的关键经历；不必写成完整传记，留白比堆事件更好用"
              onChange={(event) => setCardDraft({ ...cardDraft, background: event.target.value })}
            />
          </label>
          <label className={styles.wide}>
            <span>当前目标</span>
            <textarea
              rows={2}
              value={cardDraft.goal}
              placeholder="角色眼下想做成的事；有目标人物才会有自己的行动"
              onChange={(event) => setCardDraft({ ...cardDraft, goal: event.target.value })}
            />
          </label>
          <label className={styles.wide}>
            <span>只有角色知道的秘密</span>
            <textarea
              rows={2}
              value={cardDraft.secret}
              placeholder="不到时候不说破的隐情；用于制造试探、误会和后续反转"
              onChange={(event) => setCardDraft({ ...cardDraft, secret: event.target.value })}
            />
          </label>
          <label className={styles.wide}>
            <span>对白示例</span>
            <textarea
              rows={4}
              value={cardDraft.speechExamples}
              placeholder="三到五句能代表语气的话，每句一行；模型只学节奏，不会照抄"
              onChange={(event) =>
                setCardDraft({ ...cardDraft, speechExamples: event.target.value })
              }
            />
          </label>
          <label className={styles.wide}>
            <span>系统指令（卡内规则，低于手写系统提示）</span>
            <textarea
              rows={4}
              value={cardDraft.systemDirective}
              placeholder="例如：动刀必须有代价；每轮只放出一条线索；不替对方做重大决定"
              onChange={(event) =>
                setCardDraft({ ...cardDraft, systemDirective: event.target.value })
              }
            />
          </label>
          <label className={styles.wide}>
            <span>开场白</span>
            <textarea
              rows={3}
              value={cardDraft.greeting}
              placeholder="新对话开场白，可包含动作与环境描写；启用该卡时作为首条消息发送"
              onChange={(event) => setCardDraft({ ...cardDraft, greeting: event.target.value })}
            />
          </label>
          <label className={styles.wide}>
            <span>补充设定（不限字数）</span>
            <textarea
              rows={5}
              value={cardDraft.notes}
              placeholder="禁忌话题、长期约定、称呼习惯、前史补充；想写多少写多少，保存与重载都不会截断"
              onChange={(event) => setCardDraft({ ...cardDraft, notes: event.target.value })}
            />
          </label>
          <label className={styles.wide}>
            <span>标签（可选）</span>
            <input
              value={tagDraft}
              maxLength={CHARACTER_TAG_MAX * (CHARACTER_TAG_LENGTH + 1)}
              placeholder="以逗号分隔，最多 6 个，例如：日常、兽耳、治愈"
              onChange={(event) => setTagDraft(event.target.value)}
            />
          </label>
            </>
          ) : null}
        </div>
        <div className={styles.editorActions}>
          <button
            type="button"
            className={styles.ghostButton}
            onClick={() => {
              setCardDraft(null)
              setAvatarDraft(null)
              setTagDraft('')
            }}
          >
            取消
          </button>
          <button type="button" className={styles.primaryButton} onClick={saveCardDraft}>
            保存角色卡
          </button>
        </div>
      </div>
    )
  }

  const applyExample = (label: string) => {
    const example = CARD_EXAMPLES.find((item) => item.label === label)
    if (!example || !cardDraft) {
      return
    }
    setCardDraft({
      ...emptyCard(),
      ...example.card,
      id: cardDraft.id,
      createdAt: cardDraft.createdAt,
      updatedAt: Date.now(),
    })
    showToast({ key: 'roleplayExampleApplied', params: { name: label } })
  }

  /* -------------------- 功能区：角色卡编辑器 结束 -------------------- */

  /* -------------------- 功能区：世界书条目行渲染 开始 -------------------- */
  const renderEntryRow = (entry: WorldbookEntry) => (
    <article key={entry.id} className={styles.entryRow} data-off={!entry.enabled}>
      <div className={styles.entryHead}>
        <div>
          <strong>{entry.title}</strong>
          <span className={styles.constantTag}>
            {WORLDBOOK_KINDS.find((kind) => kind.key === entry.kind)?.label ?? '其他'}
          </span>
          <span className={styles.authorityTag} data-authority={entry.authority}>
            {WORLDBOOK_AUTHORITIES.find((authority) => authority.key === entry.authority)?.label ??
              '硬设定'}
          </span>
          {entry.scope === 'session' ? (
            <span className={styles.constantTag}>整段历史</span>
          ) : null}
          {entry.match === 'regex' ? <span className={styles.constantTag}>正则</span> : null}
          {entry.cardId ? (
            <span className={styles.constantTag}>
              仅 {cards.find((card) => card.id === entry.cardId)?.name ?? '已删除的卡'}
            </span>
          ) : null}
          {entry.always ? <span className={styles.constantTag}>每轮注入</span> : null}
          {entry.position === 'tail' ? <span className={styles.constantTag}>靠后</span> : null}
          {entry.weight !== WORLDBOOK_WEIGHT_DEFAULT ? (
            <span className={styles.constantTag}>权重 {entry.weight}</span>
          ) : null}
          {!entry.enabled ? <span className={styles.offTag}>已停用</span> : null}
        </div>
        <div className={styles.rowActions}>
          <button type="button" onClick={() => startEditEntry(entry)}>
            编辑
          </button>
          <button
            type="button"
            className={styles.dangerText}
            onClick={() => setConfirm({ kind: 'entry', id: entry.id, name: entry.title })}
          >
            删除
          </button>
        </div>
      </div>
      <p>{entry.content}</p>
      <div className={styles.keywords}>
        {entry.keywords.length > 0 ? (
          entry.keywords.map((keyword) => <span key={keyword}>{keyword}</span>)
        ) : (
          <span className={styles.mutedChip}>未设置关键词，仅在「每轮注入」开启时生效</span>
        )}
        {entry.excludeKeywords.map((keyword) => (
          <span key={`x-${keyword}`} className={styles.mutedChip}>
            避触 {keyword}
          </span>
        ))}
      </div>
    </article>
  )
  /* -------------------- 功能区：世界书条目行渲染 结束 -------------------- */

  /* -------------------- 功能区：示例应用与面板主渲染 开始 -------------------- */
  return (
    <div className={styles.panel}>
      <section className={styles.hero}>
        <div>
          <span className={styles.heroEyebrow}>角色设定</span>
          <h2>角色卡 · 世界书 · 场景</h2>
          <p>
            角色卡保存身份、关系、情景、目标、秘密与玩法，可配置头像；世界书按分类、关键词、避触词和历史范围命中；
            场景记录天气、气氛、在场人物、目标与冲突。三层内容追加在手写提示词之后，不改写原文。
            人物一旦进入某个会话，后续即使关闭全局开关也沿用该卡，避免中途换人。
          </p>
        </div>
        <div className={styles.heroStats}>
          <span>
            角色卡 <b>{cards.length}</b>
          </span>
          <span>
            启用中 <b>{roleplayOn ? '1' : '0'}</b>
          </span>
          <span>
            世界书 <b>{enabledEntries}</b>
          </span>
          <span>
            场景{' '}
            <b>
              {sceneCount}/{SCENE_FIELDS.length}
            </b>
          </span>
        </div>
      </section>

      <div className={styles.tabs} role="tablist" aria-label="角色设定分区">
        <button
          type="button"
          role="tab"
          aria-selected={panelTab === 'cards'}
          data-on={panelTab === 'cards' ? '' : undefined}
          onClick={() => setPanelTab('cards')}
        >
          角色卡 <b>{cards.length}</b>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={panelTab === 'worldbook'}
          data-on={panelTab === 'worldbook' ? '' : undefined}
          onClick={() => setPanelTab('worldbook')}
        >
          世界书 <b>{enabledEntries}</b>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={panelTab === 'scene'}
          data-on={panelTab === 'scene' ? '' : undefined}
          onClick={() => setPanelTab('scene')}
        >
          场景{' '}
          <b>
            {sceneCount}/{SCENE_FIELDS.length}
          </b>
        </button>
      </div>

      <section className={styles.section} hidden={panelTab !== 'cards'}>
        <header className={styles.sectionHead}>
          <div>
            <h3>角色卡</h3>
            <p>
              每张卡右侧为启用开关：开启后只读取这一张卡的设定，同一时间仅启用一张，避免多张卡同时污染 system。关闭只影响新会话；已经绑定这个人物的对话仍按卡设定继续。
            </p>
          </div>
          <div className={styles.headActions}>
            <button
              type="button"
              className={styles.ghostButton}
              disabled={cardImporting}
              onClick={() => cardFileInput.current?.click()}
            >
              {cardImporting ? '导入中…' : '导入角色卡'}
            </button>
            <button
              type="button"
              className={styles.primaryButton}
              onClick={() => {
                setEntryDraft(null)
                setAvatarDraft(null)
                setTagDraft('')
                setCardDraft(emptyCard(characterName))
              }}
            >
              + 新建角色卡
            </button>
            <input
              ref={cardFileInput}
              hidden
              type="file"
              accept=".json,.png,application/json,image/png"
              onChange={(event) => {
                const file = event.target.files?.[0]
                event.target.value = ''
                if (file) {
                  void importCharacter(file)
                }
              }}
            />
          </div>
        </header>

        <div className={styles.formatHint}>
          <strong>支持格式</strong>
          <span>
            Character Card V2 / V3（JSON，或含 chara / ccv3 元数据的 PNG）、TavernAI 角色卡 JSON。
            随卡 character_book
            会转为世界书并绑定该角色。缺少姓名或无法解析的文件会被拒绝，不会写入本地配置。
          </span>
        </div>

        <div className={styles.modeCard} data-on={roleplayOn}>
          <span className={styles.modeIcon} aria-hidden="true">
            {roleplayOn ? '扮' : activeCard ? '存' : '词'}
          </span>
          <div className={styles.modeMain}>
            <strong>
              {roleplayOn
                ? globalRoleplayOn && previewCard?.id === activeCard?.id
                  ? `角色扮演已开启 · ${previewCard?.name}`
                  : `本会话沿用角色 · ${previewCard?.name}`
                : activeCard
                  ? `角色扮演已关闭 · ${activeCard.name} 的卡已暂停`
                  : '角色扮演已关闭'}
            </strong>
            <p>
              {roleplayOn
                ? globalRoleplayOn && previewCard?.id === activeCard?.id
                  ? '每次请求会注入该卡设定与手写提示词，两者叠加生效。'
                  : '该人物已经进入本会话；关闭全局开关只影响新会话，这里仍按卡设定继续，不会中途换回系统人格。'
                : activeCard
                  ? '全局开关已关闭：新会话回到手写提示词；已经绑定该角色的旧会话继续沿用卡设定与场景，不会中途换人。'
                  : '当前仅发送手写提示词，不注入角色设定；启用任一张卡即可恢复角色扮演。'}
            </p>
          </div>
          {activeCard ? (
            globalRoleplayOn ? (
              <button
                type="button"
                className={styles.modeButton}
                onClick={() => closeRoleplay(activeCard)}
              >
                关闭全局开关
              </button>
            ) : (
              <button
                type="button"
                className={styles.modeButton}
                onClick={() => setRoleplayEnabled(true)}
              >
                恢复角色扮演
              </button>
            )
          ) : (
            <span className={styles.modeHint}>启用开关位于角色卡</span>
          )}
        </div>

        {cards.length > 0 ? (
          <div className={styles.searchRow}>
            <input
              value={cardQuery}
              placeholder="搜索姓名、身份、关系、性格或标签"
              aria-label="搜索角色卡"
              onChange={(event) => setCardQuery(event.target.value)}
            />
            {cardQuery ? (
              <button type="button" className={styles.linkButton} onClick={() => setCardQuery('')}>
                清空
              </button>
            ) : null}
            <span>{visibleCards.length} 张</span>
          </div>
        ) : null}

        {tagList.length > 0 ? (
          <div className={styles.tagRow} aria-label="按标签筛选角色卡">
            <button
              type="button"
              className={styles.tagChip}
              data-on={tagFilter === '' ? '' : undefined}
              onClick={() => setTagFilter('')}
            >
              全部 {cards.length}
            </button>
            {tagList.map(({ tag, count }) => (
              <button
                key={tag}
                type="button"
                className={styles.tagChip}
                data-on={tagFilter === tag ? '' : undefined}
                onClick={() => setTagFilter(tagFilter === tag ? '' : tag)}
              >
                {tag} {count}
              </button>
            ))}
          </div>
        ) : null}

        {isNewDraft ? renderCardEditor() : null}

        <div className={styles.cardList}>
          {visibleCards.map((card) => {
            const selected = card.id === activeCharacterId
            const active = selected && roleplayEnabled
            const inSession = boundCard?.id === card.id
            const editing = cardDraft?.id === card.id
            const filled = cardFieldCount(card)
            return (
              <article
                key={card.id}
                className={styles.cardRow}
                data-active={selected}
                data-editing={editing}
                data-collapsed={collapsedCards.includes(card.id) ? '' : undefined}
              >
                {editing ? (
                  <div className={styles.inlineEditor}>{renderCardEditor()}</div>
                ) : (
                  <>
                    <div className={styles.cardTop}>
                      <span
                        className={styles.cardAvatar}
                        data-photo={cardAvatars[card.id] ? '' : undefined}
                        aria-hidden="true"
                      >
                        {cardAvatars[card.id] ? (
                          <img src={cardAvatars[card.id]} alt="" />
                        ) : (
                          Array.from(card.name)[0] || '?'
                        )}
                      </span>
                      <div className={styles.cardHeading}>
                        <div className={styles.cardTitle}>
                          <strong>{card.name}</strong>
                          {selected || inSession ? (
                            <span className={styles.activeTag}>
                              {active ? '已启用' : inSession ? '本会话沿用' : '未启用'}
                            </span>
                          ) : null}
                          {card.builtin ? <span className={styles.builtinTag}>内置</span> : null}
                        </div>
                        <small>
                          {active
                            ? '当前对话主角色'
                            : inSession
                              ? '该人物已进入本会话，全局开关关闭也继续沿用'
                              : selected
                                ? '全局开关已关，新会话回到手写提示词'
                                : card.builtin
                                  ? '内置角色卡，可直接编辑'
                                  : `${formatDate(card.updatedAt)} 更新`}
                        </small>
                      </div>
                      <button
                        type="button"
                        className={styles.cardCollapse}
                        aria-expanded={!collapsedCards.includes(card.id)}
                        onClick={() => toggleCardCollapsed(card.id)}
                      >
                        {collapsedCards.includes(card.id) ? '展开' : '收起'}
                      </button>
                    </div>
                    {!collapsedCards.includes(card.id) ? (
                      <div className={styles.cardMain}>
                      <p>{card.identity || card.relationship || '未填写身份'}</p>
                      {card.greeting ? (
                        <blockquote className={styles.cardQuote}>
                          “{card.greeting.slice(0, 72)}
                          {card.greeting.length > 72 ? '…' : ''}”
                        </blockquote>
                      ) : card.style ? (
                        <p className={styles.cardStyle}>{card.style}</p>
                      ) : null}
                      {card.tags.length > 0 ? (
                        <div className={styles.cardTags}>
                          {card.tags.slice(0, 3).map((tag) => (
                            <span key={tag}>{tag}</span>
                          ))}
                          {card.tags.length > 3 ? <span>+{card.tags.length - 3}</span> : null}
                        </div>
                      ) : null}
                      <div className={styles.cardMeta}>
                        <span className={styles.cardMeter}>
                          <i style={{ width: `${(filled / CARD_FIELD_TOTAL) * 100}%` }} />
                          <em>
                            {filled}/{CARD_FIELD_TOTAL} 项
                          </em>
                        </span>
                        {card.greeting ? <span className={styles.cardFlag}>开场白</span> : null}
                        {cardAvatars[card.id] ? (
                          <span className={styles.cardFlag}>头像</span>
                        ) : null}
                      </div>
                      <div className={styles.rowActions}>
                        <button
                          type="button"
                          role="switch"
                          aria-checked={active}
                          aria-label={
                            active
                              ? `关闭「${card.name}」的全局角色扮演开关`
                              : selected
                                ? `恢复「${card.name}」的角色扮演`
                                : `启用「${card.name}」的角色扮演`
                          }
                          className={styles.cardSwitch}
                          data-on={active}
                          onClick={() => {
                            if (active) {
                              closeRoleplay(card)
                            } else if (selected) {
                              setRoleplayEnabled(true)
                            } else {
                              useCard(card)
                            }
                          }}
                        >
                          <i />
                          <span>
                            {active
                              ? '已启用'
                              : inSession
                                ? '本会话沿用'
                                : selected
                                  ? '已暂停'
                                  : '启用'}
                          </span>
                        </button>
                        <button type="button" onClick={() => startEditCard(card)}>
                          编辑
                        </button>
                        <button type="button" onClick={() => duplicateCard(card)}>
                          复制
                        </button>
                        <button
                          type="button"
                          className={styles.dangerText}
                          onClick={() => setConfirm({ kind: 'card', id: card.id, name: card.name })}
                        >
                          删除
                        </button>
                      </div>
                      </div>
                    ) : null}
                  </>
                )}
              </article>
            )
          })}
          {cards.length > 0 && visibleCards.length === 0 ? (
            <div className={styles.emptyLine}>未找到匹配「{cardQuery}」的角色卡。</div>
          ) : null}
          {cards.length === 0 && !cardDraft ? (
            <div className={styles.emptyLine}>
              尚无角色卡。可先套用上方模板，再补情景、目标与秘密；至少写清身份、关系和说话方式，长对话里的人物才不容易漂移。
            </div>
          ) : null}
        </div>
        <div className={styles.sectionFootRow}>
          <p className={styles.sectionFoot}>
            最多保存 {CHARACTER_CARD_MAX}{' '}
            张，同一时间仅保留一张全局启用卡。关闭全局开关只影响新会话；
            已经创建过该人物的会话会继续沿用卡设定、世界书、场景和角色记忆，不会突然切回手写人格。
          </p>
          <button type="button" className={styles.ghostButton} onClick={restoreBuiltinCards}>
            恢复内置角色卡（{BUILTIN_CHARACTER_CARD_TOTAL}）
          </button>
        </div>
      </section>

      <section className={styles.section} hidden={panelTab !== 'worldbook'}>
        <header className={styles.sectionHead}>
          <div>
            <h3>世界书</h3>
            <p>
              世界书按分类保存世界、人物、地点、事件、规则、物品与线索；关键词或正则命中时注入，
              避触词可压掉同名误伤，扫描范围可选最近发言或整段历史。标记「每轮注入」的条目每轮都会发送。
              支持本应用设定存档、SillyTavern world info（entries 数组或对象键值）与 Character Card
              V2 / V3 的 character_book；不支持私有数据库或未公开的二进制格式。
            </p>
          </div>
          <div className={styles.headActions}>
            <button
              type="button"
              className={styles.ghostButton}
              disabled={worldbook.length === 0}
              onClick={() => void exportWorldbook()}
            >
              导出世界书
            </button>
            <button
              type="button"
              className={styles.ghostButton}
              onClick={() => entryFileInput.current?.click()}
            >
              导入世界书
            </button>
            <button
              type="button"
              className={styles.primaryButton}
              onClick={() => {
                setCardDraft(null)
                setAvatarDraft(null)
                setKeywordDraft('')
                setExcludeDraft('')
                setEntryDraft({ ...emptyEntry(), cardId: activeCharacterId ?? '' })
              }}
            >
              + 新建条目
            </button>
            <input
              ref={entryFileInput}
              hidden
              type="file"
              accept=".json,.png,application/json,image/png"
              onChange={(event) => {
                const file = event.target.files?.[0]
                event.target.value = ''
                if (file) {
                  void importWorldbook(file)
                }
              }}
            />
          </div>
        </header>

        <div className={styles.hitLine}>
          <span>
            每轮注入 <b>{alwaysEntries}</b> 条 · 已启用 <b>{enabledEntries}</b> 条
          </span>
          <span>
            {recentText
              ? `按最近对话计算，将注入 ${hitEntries.length} 条`
              : '发送消息后显示匹配条数'}
          </span>
        </div>

        {!worldbookInject ? (
          <div className={styles.injectOff}>
            世界书注入已关闭：条目与预算保留，但不会拼进请求。可在「设置 → Token 与费用」重新开启。
          </div>
        ) : null}

        <div className={styles.budgetCard}>
          <div className={styles.budgetHead}>
            <div>
              <strong>注入字符预算</strong>
              <span>标题与正文合计上限，按命中优先级占用</span>
            </div>
            <b>{worldbookChars.toLocaleString('zh-CN')} 字</b>
          </div>
          <div className={styles.budgetPresets} aria-label="世界书注入预算预设">
            {[1000, 2000, 4000, 8000].map((preset) => (
              <button
                key={preset}
                type="button"
                data-on={worldbookChars === preset ? '' : undefined}
                onClick={() => applyBudget(preset)}
              >
                {preset.toLocaleString('zh-CN')}
              </button>
            ))}
          </div>
          <label className={styles.budgetCustom}>
            <span>自定义</span>
            <input
              type="number"
              inputMode="numeric"
              min={WORLDBOOK_BUDGET_MIN}
              max={WORLDBOOK_BUDGET_MAX}
              step={100}
              value={budgetDraft}
              aria-label="世界书注入字符预算"
              onChange={(event) => setBudgetDraft(event.target.value.replace(/[^0-9]/g, ''))}
              onBlur={() => {
                const value = Number(budgetDraft)
                if (!Number.isFinite(value) || value <= 0) {
                  setBudgetDraft(String(worldbookChars))
                  return
                }
                applyBudget(value)
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.currentTarget.blur()
                }
              }}
            />
            <em>字</em>
          </label>
          <p>
            默认 {WORLDBOOK_BUDGET_DEFAULT.toLocaleString('zh-CN')} 字，范围{' '}
            {WORLDBOOK_BUDGET_MIN.toLocaleString('zh-CN')}–
            {WORLDBOOK_BUDGET_MAX.toLocaleString('zh-CN')}。
            预算过高会挤占对话上下文，请按模型窗口和实际条目长度调整；未命中条目不计入。
          </p>
        </div>

        {entryDraft ? (
          <div className={styles.editor}>
            <div className={styles.editorHead}>
              <strong>
                {worldbook.some((entry) => entry.id === entryDraft.id) ? '编辑条目' : '新建条目'}
              </strong>
              <span>
                关键词以逗号分隔；命中任意一个时注入该条目；避触词命中时整条跳过。可信度决定它能不能被对话推翻。
              </span>
            </div>
            <div className={styles.fieldGrid}>
              <label>
                <span>标题 *</span>
                <input
                  value={entryDraft.title}
                  maxLength={60}
                  placeholder="例如：夜班便利店"
                  onChange={(event) => setEntryDraft({ ...entryDraft, title: event.target.value })}
                />
                {worldbook.some(
                  (entry) =>
                    entry.id !== entryDraft.id &&
                    entry.cardId === entryDraft.cardId &&
                    entry.kind === entryDraft.kind &&
                    entry.title.trim() === entryDraft.title.trim() &&
                    entryDraft.title.trim()
                ) ? (
                  <small className={styles.fieldHint}>
                    同一生效范围内已有同名条目，保存前先确认是不是重复。
                  </small>
                ) : null}
              </label>
              <label>
                <span>分类</span>
                <select
                  value={entryDraft.kind}
                  onChange={(event) =>
                    setEntryDraft({
                      ...entryDraft,
                      kind: event.target.value as WorldbookEntry['kind'],
                    })
                  }
                >
                  {WORLDBOOK_KINDS.map((kind) => (
                    <option key={kind.key} value={kind.key}>
                      {kind.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>可信度</span>
                <select
                  value={entryDraft.authority}
                  onChange={(event) =>
                    setEntryDraft({
                      ...entryDraft,
                      authority: event.target.value as WorldbookEntry['authority'],
                    })
                  }
                >
                  {WORLDBOOK_AUTHORITIES.map((authority) => (
                    <option key={authority.key} value={authority.key}>
                      {authority.label}
                    </option>
                  ))}
                </select>
                <small className={styles.fieldHint}>
                  {
                    WORLDBOOK_AUTHORITIES.find(
                      (authority) => authority.key === entryDraft.authority
                    )?.hint
                  }
                </small>
              </label>
              <label>
                <span>{entryDraft.match === 'regex' ? '正则' : '关键词'}</span>
                <input
                  value={keywordDraft}
                  placeholder={
                    entryDraft.match === 'regex' ? '便利(店|铺)，夜\\s*班' : '便利店，夜班，热牛奶'
                  }
                  onChange={(event) => setKeywordDraft(event.target.value)}
                />
              </label>
              <label>
                <span>避触词（可选）</span>
                <input
                  value={excludeDraft}
                  placeholder="例如：便利店已关门、夜班取消"
                  onChange={(event) => setExcludeDraft(event.target.value)}
                />
              </label>
              <label className={styles.wide}>
                <span>匹配方式</span>
                <div className={styles.toggleRow}>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={entryDraft.match === 'keyword'}
                    className={styles.toggle}
                    data-on={entryDraft.match === 'keyword'}
                    onClick={() => setEntryDraft({ ...entryDraft, match: 'keyword' })}
                  >
                    关键词包含
                  </button>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={entryDraft.match === 'regex'}
                    className={styles.toggle}
                    data-on={entryDraft.match === 'regex'}
                    onClick={() => setEntryDraft({ ...entryDraft, match: 'regex' })}
                  >
                    正则表达式
                  </button>
                </div>
              </label>
              <label className={styles.wide}>
                <span>扫描范围</span>
                <div className={styles.toggleRow}>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={entryDraft.scope === 'recent'}
                    className={styles.toggle}
                    data-on={entryDraft.scope === 'recent'}
                    onClick={() => setEntryDraft({ ...entryDraft, scope: 'recent' })}
                  >
                    最近发言
                  </button>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={entryDraft.scope === 'session'}
                    className={styles.toggle}
                    data-on={entryDraft.scope === 'session'}
                    onClick={() => setEntryDraft({ ...entryDraft, scope: 'session' })}
                  >
                    整段历史
                  </button>
                </div>
              </label>
              <label className={styles.wide}>
                <span>生效范围</span>
                <div className={styles.toggleRow}>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={!entryDraft.cardId}
                    className={styles.toggle}
                    data-on={!entryDraft.cardId}
                    onClick={() => setEntryDraft({ ...entryDraft, cardId: '' })}
                  >
                    所有角色
                  </button>
                  {cards.map((card) => (
                    <button
                      key={card.id}
                      type="button"
                      role="switch"
                      aria-checked={entryDraft.cardId === card.id}
                      className={styles.toggle}
                      data-on={entryDraft.cardId === card.id}
                      onClick={() => setEntryDraft({ ...entryDraft, cardId: card.id })}
                    >
                      {card.name}
                    </button>
                  ))}
                </div>
              </label>
              <label className={styles.wide}>
                <span>权重（0–100）</span>
                <div className={styles.toggleRow}>
                  <input
                    className={styles.weightInput}
                    type="number"
                    min={0}
                    max={100}
                    step={5}
                    value={entryDraft.weight}
                    aria-label="世界书权重"
                    onChange={(event) =>
                      setEntryDraft({
                        ...entryDraft,
                        weight: Number(event.target.value),
                      })
                    }
                  />
                  <button
                    type="button"
                    className={styles.ghostButton}
                    onClick={() => setEntryDraft({ ...entryDraft, weight: 70 })}
                  >
                    常用背景 70
                  </button>
                  <button
                    type="button"
                    className={styles.ghostButton}
                    onClick={() => setEntryDraft({ ...entryDraft, weight: 30 })}
                  >
                    细节补充 30
                  </button>
                </div>
              </label>
              <label className={styles.wide}>
                <span>插入位置</span>
                <div className={styles.toggleRow}>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={entryDraft.position === 'context'}
                    className={styles.toggle}
                    data-on={entryDraft.position === 'context'}
                    onClick={() => setEntryDraft({ ...entryDraft, position: 'context' })}
                  >
                    人物设定之前
                  </button>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={entryDraft.position === 'tail'}
                    className={styles.toggle}
                    data-on={entryDraft.position === 'tail'}
                    onClick={() => setEntryDraft({ ...entryDraft, position: 'tail' })}
                  >
                    提示词之后
                  </button>
                </div>
              </label>
              <label className={styles.wide}>
                <span>设定内容 *</span>
                <textarea
                  rows={5}
                  value={entryDraft.content}
                  placeholder="记录稳定设定：地点环境、人物关系、规则与既往事件；随剧情变化的状态请写入场景。"
                  onChange={(event) =>
                    setEntryDraft({ ...entryDraft, content: event.target.value })
                  }
                />
              </label>
            </div>
            <div className={styles.toggleRow}>
              <button
                type="button"
                role="switch"
                aria-checked={entryDraft.enabled}
                className={styles.toggle}
                data-on={entryDraft.enabled}
                onClick={() => setEntryDraft({ ...entryDraft, enabled: !entryDraft.enabled })}
              >
                {entryDraft.enabled ? '已启用' : '已停用'}
              </button>
              <button
                type="button"
                role="switch"
                aria-checked={entryDraft.always}
                className={styles.toggle}
                data-on={entryDraft.always}
                onClick={() => setEntryDraft({ ...entryDraft, always: !entryDraft.always })}
              >
                {entryDraft.always ? '每轮注入' : '命中注入'}
              </button>
            </div>
            <div className={styles.editorActions}>
              <button
                type="button"
                className={styles.ghostButton}
                onClick={() => setEntryDraft(null)}
              >
                取消
              </button>
              <button type="button" className={styles.primaryButton} onClick={saveEntryDraft}>
                保存条目
              </button>
            </div>
          </div>
        ) : null}

        <div className={styles.listSearch}>
          <input
            value={entryQuery}
            onChange={(event) => setEntryQuery(event.target.value)}
            placeholder="搜索标题、关键词或正文"
            aria-label="搜索世界书条目"
          />
          {entryQuery.trim() ? (
            <button type="button" onClick={() => setEntryQuery('')} aria-label="清除搜索">
              清除
            </button>
          ) : null}
        </div>
        <div className={styles.toggleRow}>
          <button
            type="button"
            role="switch"
            aria-checked={entryKindFilter === 'all'}
            className={styles.toggle}
            data-on={entryKindFilter === 'all'}
            onClick={() => setEntryKindFilter('all')}
          >
            全部
          </button>
          {WORLDBOOK_KINDS.map((kind) => (
            <button
              key={kind.key}
              type="button"
              role="switch"
              aria-checked={entryKindFilter === kind.key}
              className={styles.toggle}
              data-on={entryKindFilter === kind.key}
              onClick={() => setEntryKindFilter(kind.key)}
            >
              {kind.label}
            </button>
          ))}
          <button
            type="button"
            className={styles.linkButton}
            onClick={() =>
              setCollapsedEntryKinds(allEntryGroupsOpen ? entryGroups.map((group) => group.key) : [])
            }
          >
            {allEntryGroupsOpen ? '收起全部分类' : '展开全部分类'}
          </button>
        </div>

        <div className={styles.list}>
          {entryGroups.map((group) => {
            const collapsed = collapsedEntryKinds.includes(group.key)
            return (
              <section key={group.key} className={styles.entryGroup}>
                <button
                  type="button"
                  className={styles.entryGroupHead}
                  aria-expanded={!collapsed}
                  onClick={() => toggleEntryKind(group.key)}
                >
                  <strong>{group.label}</strong>
                  <small>{group.entries.length} 条</small>
                  <i>{collapsed ? '展开' : '收起'}</i>
                </button>
                {!collapsed ? (
                  <div className={styles.entryGroupBody}>
                    {group.entries.map((entry) => renderEntryRow(entry))}
                  </div>
                ) : null}
              </section>
            )
          })}
          {entryNeedle && filteredEntries.length === 0 && worldbook.length > 0 ? (
            <div className={styles.emptyLine}>
              未找到匹配「{entryQuery.trim()}」的条目，请调整关键词或清除搜索。
            </div>
          ) : null}
          {worldbook.length === 0 && !entryDraft ? (
            <div className={styles.emptyLine}>
              尚未添加世界书条目。可录入世界规则、地点、人物、组织、事件与线索；关键词命中时才注入，未命中不占用上下文。
            </div>
          ) : null}
        </div>
      </section>

      <section className={styles.section} hidden={panelTab !== 'scene'}>
        <header className={styles.sectionHead}>
          <div>
            <h3>当前场景</h3>
            <p>
              记录时间、天气、在场人物、气氛、目标、冲突与关键物件。可手动修改，或开启自动更新由模型在每轮后重写；角色扮演关闭时只保留记录，已绑定人物的会话仍继续注入。
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={sceneAutoUpdate}
            className={styles.autoToggle}
            data-on={sceneAutoUpdate}
            onClick={() => setSceneAutoUpdate(!sceneAutoUpdate)}
          >
            <i />
            <span>{sceneAutoUpdate ? '自动更新：开' : '自动更新：关'}</span>
          </button>
        </header>

        <div className={styles.notice} data-warn={sceneAutoUpdate}>
          {sceneAutoUpdate
            ? '开启后，每轮回复结束会额外发送一次摘要请求，由模型更新全部场景字段；会产生额外 Token 消耗，请求失败时保留原场景，不影响对话。'
            : '关闭时仅在手动编辑后更新，不产生额外请求。'}
        </div>

        <div className={styles.sceneGrid}>
          {SCENE_FIELDS.map((field) => (
            <label key={field.key} className={field.wide ? styles.wide : ''}>
              <span>{field.label}</span>
              {field.wide ? (
                <textarea
                  rows={field.lines ?? 2}
                  value={sceneDraft[field.key]}
                  maxLength={SCENE_LIMITS[field.key]}
                  placeholder={field.placeholder}
                  onChange={(event) =>
                    setSceneDraft({ ...sceneDraft, [field.key]: event.target.value })
                  }
                  onBlur={(event) => {
                    if (event.target.value !== scene[field.key]) {
                      setSceneField(field.key as SceneField, event.target.value)
                    }
                  }}
                />
              ) : (
                <input
                  value={sceneDraft[field.key]}
                  maxLength={SCENE_LIMITS[field.key]}
                  placeholder={field.placeholder}
                  onChange={(event) =>
                    setSceneDraft({ ...sceneDraft, [field.key]: event.target.value })
                  }
                  onBlur={(event) => {
                    if (event.target.value !== scene[field.key]) {
                      setSceneField(field.key as SceneField, event.target.value)
                    }
                  }}
                />
              )}
            </label>
          ))}
        </div>

        <div className={styles.sceneFooter}>
          <span>{scene.updatedAt ? `${formatDate(scene.updatedAt)} 更新` : '尚未填写'}</span>
          <button
            type="button"
            className={styles.ghostButton}
            disabled={!sceneHasContent(scene)}
            onClick={() => {
              clearScene()
              setSceneDraft({ ...useSettings.getState().scene })
              showToast({ key: 'roleplaySceneCleared' })
            }}
          >
            清空场景
          </button>
        </div>
      </section>

      <p className={styles.footerNote}>
        角色卡、世界书与场景只保存在本机，单会话包可带走相关设定。关闭全局开关只影响新会话，
        已绑定人物的会话仍注入卡设定、世界书、场景与角色记忆；单轮最多注入 6 条世界书，当前预算{' '}
        {worldbookChars.toLocaleString('zh-CN')} 字；
        超出后按命中次数与权重排序取前面的条目，避免背景设定挤占对话上下文。
      </p>

      {confirm ? (
        <div className={styles.confirmOverlay} onClick={() => setConfirm(null)}>
          <div className={styles.confirmCard} onClick={(event) => event.stopPropagation()}>
            <strong>删除「{confirm.name}」？</strong>
            <p>
              {confirm.kind === 'card'
                ? '只删这张卡。手写的提示词和以前的对话都不动。'
                : '只删这条背景。已经聊过的消息不会变。'}
            </p>
            <div className={styles.confirmActions}>
              <button type="button" className={styles.ghostButton} onClick={() => setConfirm(null)}>
                取消
              </button>
              <button type="button" className={styles.dangerButton} onClick={doDelete}>
                删除
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
/* -------------------- 功能区：示例应用与面板主渲染 结束 -------------------- */

/* ============================================================================
 * 功能区：设置页 / RoleplayPanel 结束
 * ========================================================================== */
