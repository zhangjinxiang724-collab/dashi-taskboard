export const AI_DRAFT_FIXTURES = {
  ADD: {
    suggested_update_type: "ADD",
    new_information: "新增了一个需要纳入判断的事实。",
    impact: "我原来认为：原观点。现在需要加入这个新变量。",
    claim_changes: [{ action: "ADD", claim_id: null, replacement: null, text: "现在还需要纳入新变量" }],
  },
  REINFORCE: {
    suggested_update_type: "REINFORCE",
    new_information: "资料为原判断补充了新的证据。",
    impact: "原判断得到进一步支持。",
    claim_changes: [],
  },
  REVISE: {
    suggested_update_type: "REVISE",
    new_information: "资料显示原判断的一项前提已经变化。",
    impact: "原判断需要收窄适用范围。",
    claim_changes: [{ action: "MODIFY", claim_id: "C1", replacement: "原观点中受影响的部分已经修正", text: null }],
  },
  UNCERTAIN: {
    suggested_update_type: "UNCERTAIN",
    new_information: "资料提出了一个值得继续验证的信号。",
    impact: "现有证据还不足以改变判断。",
    claim_changes: [],
  },
};

export const AI_DELTA_FIXTURES = [
  { id: "modify-b", base: "A 保留。B 旧判断。", type: "REVISE", changes: [{ action: "MODIFY", claim_id: "C2", replacement: "B 新判断", text: null }], expected: "A 保留。B 新判断。" },
  { id: "add-d", base: "A 保留。B 保留。C 保留。", type: "ADD", changes: [{ action: "ADD", claim_id: null, replacement: null, text: "D 新判断" }], expected: "A 保留。B 保留。C 保留。D 新判断。" },
  { id: "reinforce", base: "A 保留。B 保留。", type: "REINFORCE", changes: [], expected: "A 保留。B 保留。" },
  { id: "uncertain", base: "A 保留。B 保留。", type: "UNCERTAIN", changes: [], expected: "A 保留。B 保留。" },
  { id: "modify-many", base: "A 保留。B 旧。C 保留。D 旧。", type: "REVISE", changes: [{ action: "MODIFY", claim_id: "C2", replacement: "B 新", text: null }, { action: "MODIFY", claim_id: "C4", replacement: "D 新", text: null }], expected: "A 保留。B 新。C 保留。D 新。" },
  { id: "unsupported-modify", invalid: true, base: "A 保留。B 保留。", type: "ADD", changes: [{ action: "MODIFY", claim_id: "C1", replacement: "A 被改", text: null }] },
  { id: "unknown-id", invalid: true, base: "A 保留。", type: "REVISE", changes: [{ action: "MODIFY", claim_id: "C9", replacement: "错误", text: null }] },
  { id: "add-only-modify", invalid: true, base: "A 保留。", type: "ADD", changes: [{ action: "MODIFY", claim_id: "C1", replacement: "A 新", text: null }] },
  { id: "revise-no-modify", invalid: true, base: "A 保留。", type: "REVISE", changes: [{ action: "ADD", claim_id: null, replacement: null, text: "B 新" }] },
  { id: "unknown-to-fact", invalid: true, base: "目前无法判断 X。", type: "REVISE", source: "资料没有说明 X 是否发生。", changes: [{ action: "MODIFY", claim_id: "C1", replacement: "X 没有发生", text: null }] },
];

export const AI_QUALITY_CASES = [
  {
    id: "add-overseas-channel",
    expected: "ADD",
    currentView: "公司增长主要由核心订阅业务驱动，客户留存稳定，但暂不把海外市场计入主要增长来源。",
    source: "海外试点用户数量连续两个季度增长，海外收入占比仍小，但已经形成可重复的合作伙伴获客模式。资料没有提供总市场规模、盈利预测或长期趋势证据。",
    forbidden: ["稳定增长", "持续增长", "可规模化", "规模化复制", "长期成立"],
  },
  {
    id: "add-service-revenue",
    expected: "ADD",
    currentView: "公司的利润率主要受产品定价和原材料成本影响。",
    source: "本季度售后服务收入占比提高到十二个百分点，并带来一项新的经常性收入来源；资料没有说明这一比例能否长期维持。",
    forbidden: ["长期", "稳定", "已经证明"],
  },
  {
    id: "add-delivery-observation",
    expected: "ADD",
    currentView: "当前交付压力主要来自产能限制，新增产线投产前仍需谨慎看待收入兑现速度。",
    source: "最近一个季度的物流调整使部分区域交付周期缩短，但样本只覆盖两个区域，也没有改变新增产线尚未投产的事实。",
    forbidden: ["全面改善", "长期改善", "稳定改善"],
  },
  {
    id: "add-small-consecutive-growth",
    expected: "ADD",
    currentView: "国内需求仍是公司近期订单的主要来源。",
    source: "三个连续月份观察到小规模海外试点订单增加，但客户数量有限，尚不能判断趋势能否持续。",
    forbidden: ["稳定增长", "持续增长", "规模化", "长期"],
  },
  {
    id: "reinforce-switching-cost",
    expected: "REINFORCE",
    currentView: "公司的竞争优势来自售后服务网络和较高的客户转换成本，短期订单波动不改变长期判断。",
    source: "多位客户表示更换供应商需要重新认证和培训，通常耗时数月；本季度订单下降主要源于推迟验收，没有发现大规模流失证据。",
    unchangedAllowed: true,
  },
  {
    id: "reinforce-weak-support",
    expected: "REINFORCE",
    currentView: "较长的客户验证周期可能形成一定转换成本，但证据仍有限。",
    source: "两名受访客户都提到更换方案需要重新完成内部验证，资料只提供了有限支持，没有覆盖其他客户。",
    unchangedAllowed: true,
  },
  {
    id: "reinforce-seasonality",
    expected: "REINFORCE",
    currentView: "现金回款具有明显季节性，单个季度的下降不代表长期恶化。",
    source: "过去三个年度都出现年中回款较低、年末回升的相似节奏，本季度下降仍处于这一历史区间。",
    unchangedAllowed: true,
  },
  {
    id: "revise-online-margin",
    expected: "REVISE",
    currentView: "线上渠道增长足以抵消门店客流下滑，因此利润率可以保持稳定。",
    source: "线上收入继续增长，但履约与退货成本显著上升，线上业务贡献利润下降；门店客流仍在下滑。资料只否定线上增长足以稳定利润率这一前提。",
  },
  {
    id: "revise-customer-concentration",
    expected: "REVISE",
    currentView: "客户集中度正在下降，因此单一大客户变化对收入的影响正在减弱。",
    source: "经审计数据表明，最大客户收入占比从上一年的百分之三十上升到百分之四十五，客户集中度并未下降。",
  },
  {
    id: "revise-factory-cost",
    expected: "REVISE",
    currentView: "新工厂投产后已经降低单位成本，产能扩张正在改善利润率。",
    source: "新工厂投产后的两个季度利用率低于计划，单位成本反而高于旧工厂；资料没有否定未来利用率提高的可能。",
  },
  {
    id: "uncertain-single-interview",
    expected: "UNCERTAIN",
    currentView: "新工艺可能降低单位成本，但尚未验证能否稳定量产。",
    source: "一份未交叉验证的单次访谈称试验线成本下降，但没有样本规模、连续运行时间、良率或正式产量数据。",
    mustRemainUnchanged: true,
  },
  {
    id: "uncertain-strong-language-weak-evidence",
    expected: "UNCERTAIN",
    currentView: "新产品是否形成明显技术优势仍需等待第三方测试。",
    source: "公司宣传材料称产品具有革命性优势，但没有给出测试方法、对照样本或第三方验证结果。",
    mustRemainUnchanged: true,
    forbidden: ["革命性优势已经成立", "已经证明"],
  },
  {
    id: "uncertain-small-pilot",
    expected: "UNCERTAIN",
    currentView: "自动化方案可能缩短处理时间，但目前不能判断是否适合大范围部署。",
    source: "一个五人小组进行了两天试用并报告处理速度更快，但缺少试用前基线、错误率和更长周期数据。",
    mustRemainUnchanged: true,
  },
];

export const AI_LANGUAGE_STYLE_FIXTURE = {
  id: "macro-us-china-price-language",
  category: "宏观经济",
  currentView: "我原来用‘美国能忍受更高通胀、中国仍在全面通缩’这两个标签理解两国经济。",
  source: "脱敏资料显示，美国的消费价格上涨速度仍高于政策目标，经济也没有明显降温；中国的消费价格开始回升，但居民消费、就业、收入和企业利润是否同步恢复还不确定。资料没有证明这些变化会长期持续。",
  oldOutput: {
    suggested_update_type: "REVISE",
    new_information: "中美CPI与PPI走势分化，揭示需求端修复与供给侧压力并存的结构性矛盾。",
    impact: "工资—价格螺旋与通缩螺旋通过传导机制影响有效需求，原有宏观判断框架需要系统性调整。",
    proposed_current_view: "中美宏观环境进入通胀与通缩压力长期共存格局，应关注需求端修复及价格动力的边际改善。",
  },
  newOutput: {
    suggested_update_type: "REVISE",
    new_information: "美国并不是完全不在意通胀，物价压力仍然存在。中国也不能再简单说成全面通缩，因为消费价格已经开始回升，但需求是否真正恢复还需要观察。",
    impact: "我原来用‘美国能忍受更高通胀、中国还在通缩’两个标签理解两国经济。现在看，这种理解太粗。美国更需要防止经济重新过热，中国更需要确认消费和收入是否真正恢复。",
    proposed_current_view: "以后判断一个国家面对的是通胀还是通缩，不能只看一个价格指标。还要一起看消费、就业、居民收入和企业利润有没有改善。价格是表面，背后的需求和收入变化更重要。",
  },
};

export const AI_LANGUAGE_STYLE_CASES = [
  AI_LANGUAGE_STYLE_FIXTURE,
  {
    id: "company-customer-concentration",
    category: "公司研究",
    currentView: "我原来认为，公司客户越来越分散，单一客户变化不会明显影响收入。",
    source: "经审计数据表明，最大客户收入占比从30%升到45%。资料没有说明其他客户未来是否会增加采购。",
    newOutput: {
      suggested_update_type: "REVISE",
      new_information: "最大客户带来的收入占比从30%升到了45%。这说明公司现在反而更依赖一个大客户。",
      impact: "我原来认为客户正在变得更分散。现在看，这个判断不对。真正需要修正的是，单一客户变化仍可能明显影响收入。",
      proposed_current_view: "以后判断公司的收入是否稳健，不能只看总收入增长。还要看最大客户占比有没有下降，以及其他客户能不能补上缺口。目前客户集中风险比我原来判断的更高。",
    },
  },
  {
    id: "history-single-diary",
    category: "历史研究",
    currentView: "我原来认为，一本官员日记足以说明当时政府内部的共同态度。",
    source: "新找到的会议记录显示，同一时期官员之间存在明显分歧。日记只代表其中一人的观察，会议记录也没有覆盖所有决策者。",
    newOutput: {
      suggested_update_type: "REVISE",
      new_information: "同一时期的官员并不是只有一种看法。个人日记只能说明一个人怎么想，不能直接代表整个政府。",
      impact: "我原来把一份个人记录当成了共同态度。现在看，这个依据太窄。真正需要调整的是，要把个人记录和多人会议记录放在一起看。",
      proposed_current_view: "以后判断一个历史群体的立场，不能只依赖一个人的日记。还要比较不同人的记录、会议材料和最后采取的行动。目前只能确认内部存在分歧，不能说所有人都持同一种态度。",
    },
  },
  {
    id: "technology-ai-pilot",
    category: "技术 / AI",
    currentView: "我原来认为，内部试用速度更快，就说明这个 AI 工具适合全面部署。",
    source: "五人小组试用了两天，完成任务更快，但没有记录错误率、复核时间或长期使用情况。",
    newOutput: {
      suggested_update_type: "UNCERTAIN",
      new_information: "小范围试用时，几个人完成任务更快。这是一个值得继续验证的信号，但还不知道错误和复核会不会抵消节省的时间。",
      impact: "我原来把‘更快’直接理解成适合全面部署。现在看，现有试用人数少、时间短，还不足以改变判断。",
      proposed_current_view: "我原来认为，内部试用速度更快，就说明这个 AI 工具适合全面部署。",
    },
  },
  {
    id: "health-short-sleep-study",
    category: "医疗或健康",
    currentView: "我原来认为，只要一种补充剂在短期试验中改善睡眠，就适合长期使用。",
    source: "一项四周小样本试验中，部分参与者入睡更快，但没有长期随访，也没有充分记录副作用。资料不能证明长期效果和安全性。",
    newOutput: {
      suggested_update_type: "REVISE",
      new_information: "这项小试验只说明，部分人在四周内入睡更快。它还不能说明长期使用是否有效，也没有充分回答副作用问题。",
      impact: "我原来把短期改善直接当成了适合长期使用。现在看，这个判断超出了现有证据。真正需要修正的是，短期效果和长期安全要分开判断。",
      proposed_current_view: "以后判断一种补充剂是否值得长期使用，不能只看短期睡眠有没有改善。还要看参与人数、试验时间、副作用和长期随访。现有资料不足以支持长期使用。",
    },
  },
  {
    id: "life-commute-route",
    category: "普通生活",
    currentView: "我原来认为，新路线有一天更快，就应该每天改走新路线。",
    source: "新路线在一次周二早晨通勤中少用了12分钟，但还没有比较雨天、周一高峰或连续多日的情况。",
    newOutput: {
      suggested_update_type: "UNCERTAIN",
      new_information: "新路线有一次少用了12分钟。这值得继续试，但还不知道是不是当天路况刚好更顺。",
      impact: "我原来想用一天的结果决定以后每天怎么走。现在看，一次通勤还不足以改变固定路线。",
      proposed_current_view: "我原来认为，新路线有一天更快，就应该每天改走新路线。",
    },
  },
];

export const AI_TYPE_PRECEDENCE_CASES = [
  {
    id: "revise-existing-negative-claim",
    expected: "REVISE",
    currentView: "我认为 A 没有发生。",
    source: "可靠资料显示，A 已经出现一些初步迹象。",
    reason: "旧观点中的否定判断必须降低确定性",
  },
  {
    id: "add-new-dimension",
    expected: "ADD",
    currentView: "我目前只从 A 判断这个问题。",
    source: "可靠资料第一次提供了独立维度 B，且没有改变关于 A 的判断。",
    reason: "B 是全新维度且无需修改已有判断",
  },
  {
    id: "reinforce-existing-possibility",
    expected: "REINFORCE",
    currentView: "A 可能发生。",
    source: "新的可靠证据继续支持 A 可能发生，但仍不足以确认。",
    reason: "新证据支持原有可能性且无需改写",
  },
  {
    id: "add-b-with-a-unchanged",
    expected: "ADD",
    currentView: "A 已经明确成立。",
    source: "可靠资料确认 A 仍然成立，同时第一次提供了独立维度 B；B 不改变 A 的成立范围。",
    reason: "A 无需修改，B 是可靠的新维度",
  },
  {
    id: "revise-condition-added",
    expected: "REVISE",
    currentView: "A 明确成立。",
    source: "可靠资料显示，A 只在条件 C 存在时成立。",
    reason: "旧判断必须增加成立条件",
  },
  {
    id: "preserve-unknown-polarity",
    expected: "UNCERTAIN",
    currentView: "目前无法判断 X。",
    source: "资料没有说明 X 是否发生，也没有提供可以判断 X 的证据。",
    reason: "未知不能转换成肯定或否定事实",
    forbidden: ["X 没有发生", "X 已经发生", "X 不存在", "X 存在"],
  },
];

export const AI_SCOPE_PRESERVATION_CASES = [
  {
    id: "revise-b-keep-a",
    type: "REVISE",
    base: "我原来用‘美国的物价压力仍需观察、中国仍处于全面通缩’两个判断理解两国经济。",
    proposed: "美国的物价压力仍需观察。中国价格开始回升，但需求是否同步恢复还不确定。",
  },
  {
    id: "add-d-keep-abc",
    type: "ADD",
    base: "产品增长保持正常。客户留存较稳定。估值风险仍然较高。",
    proposed: "产品增长保持正常。客户留存较稳定。估值风险仍然较高。以后还要观察海外渠道能否形成可靠贡献。",
  },
  {
    id: "reinforce-a-keep-b",
    type: "REINFORCE",
    base: "售后服务形成客户黏性。原材料价格仍会影响利润。",
    proposed: "售后服务形成客户黏性。原材料价格仍会影响利润。",
  },
  {
    id: "uncertain-keep-all-verbatim",
    type: "UNCERTAIN",
    base: "新工艺可能降低成本。量产稳定性仍需验证。",
    proposed: "新工艺可能降低成本。量产稳定性仍需验证。",
  },
  {
    id: "company-revise-valuation-only",
    type: "REVISE",
    base: "收入增长仍然健康。客户转换成本构成护城河。当前估值处于合理区间。",
    proposed: "收入增长仍然健康。客户转换成本构成护城河。最新价格上涨后，当前估值已经偏高。",
  },
  {
    id: "health-revise-one-claim",
    type: "REVISE",
    base: "规律睡眠有助于白天保持精力。晚间咖啡会影响入睡。周末适量运动让我感觉更好。",
    proposed: "规律睡眠有助于白天保持精力。新记录显示少量晚间咖啡未必影响我的入睡，但还需要继续观察。周末适量运动让我感觉更好。",
  },
];
