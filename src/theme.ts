export type ThemeName =
  | 'minimalism' | 'ocean' | 'emerald' | 'royal' | 'sunset' | 'rose'
  | 'sand' | 'graphite' | 'midnight' | 'neonGlass' | 'aurora' | 'liquidGlass'

export type ThemeInfo = {
  id: ThemeName
  dark: boolean
  name: { English:string; 'دری':string; 'پښتو':string }
  description: { English:string; 'دری':string; 'پښتو':string }
  colors: [string,string,string]
}

export const themes: ThemeInfo[] = [
  {id:'minimalism',dark:false,name:{English:'Minimal Professional','دری':'مینیمال حرفه‌ای','پښتو':'مسلکي مینیمال'},description:{English:'Clean white, navy and teal','دری':'سفید، سرمه‌ای و سبزآبی تمیز','پښتو':'سپین، سمندري او شین آبي'},colors:['#f8fafc','#0f172a','#0f766e']},
  {id:'ocean',dark:false,name:{English:'Ocean Blue','دری':'آبی اقیانوسی','پښتو':'سمندري آبي'},description:{English:'Fresh blue business interface','دری':'ظاهر تجارتی آبی و روشن','پښتو':'روښانه آبي سوداګریز ډیزاین'},colors:['#eff6ff','#1d4ed8','#06b6d4']},
  {id:'emerald',dark:false,name:{English:'Emerald Office','دری':'زمردی اداری','پښتو':'زمردي دفتر'},description:{English:'Calm green financial workspace','دری':'محیط آرام سبز برای مدیریت','پښتو':'ارام شین مدیریتي چاپېریال'},colors:['#f0fdf4','#047857','#22c55e']},
  {id:'royal',dark:false,name:{English:'Royal Violet','دری':'بنفش سلطنتی','پښتو':'شاهي بنفش'},description:{English:'Elegant violet and indigo','دری':'بنفش و نیلی شیک و مدرن','پښتو':'ښکلی بنفش او نیلي'},colors:['#faf5ff','#6d28d9','#8b5cf6']},
  {id:'sunset',dark:false,name:{English:'Sunset Orange','دری':'غروب نارنجی','پښتو':'نارنجي ماښام'},description:{English:'Warm amber and coral accents','دری':'نارنجی و مرجانی گرم','پښتو':'تود نارنجي او مرجاني'},colors:['#fff7ed','#c2410c','#f59e0b']},
  {id:'rose',dark:false,name:{English:'Rose Quartz','دری':'رز کوارتز','پښتو':'ګلابي کوارتز'},description:{English:'Soft rose and burgundy','دری':'صورتی نرم با سرخ تیره','پښتو':'نرم ګلابي او تیاره سور'},colors:['#fff1f2','#be123c','#fb7185']},
  {id:'sand',dark:false,name:{English:'Desert Sand','دری':'شن صحرا','پښتو':'دښتې شګه'},description:{English:'Warm sand, coffee and gold','دری':'شن، قهوه‌ای و طلایی گرم','پښتو':'توده شګه، قهوه او زرین'},colors:['#fffbeb','#78350f','#d97706']},
  {id:'graphite',dark:true,name:{English:'Graphite Dark','دری':'گرافیت تیره','پښتو':'تیاره ګرافایټ'},description:{English:'Neutral charcoal workspace','دری':'محیط ذغالی خنثی و رسمی','پښتو':'رسمي ذغالي چاپېریال'},colors:['#111827','#e5e7eb','#94a3b8']},
  {id:'midnight',dark:true,name:{English:'Midnight Navy','دری':'سرمه‌ای نیمه‌شب','پښتو':'د نیمې شپې سمندري'},description:{English:'Deep navy with cyan highlights','دری':'سرمه‌ای عمیق با فیروزه‌ای','پښتو':'ژور سمندري له فیروزه‌يي سره'},colors:['#07111f','#e2e8f0','#22d3ee']},
  {id:'neonGlass',dark:true,name:{English:'Neon Glass','دری':'شیشه نئونی','پښتو':'نیون ښیښه'},description:{English:'Purple neon on dark glass','دری':'نئون بنفش روی شیشه تیره','پښتو':'بنفش نیون پر تیاره ښیښه'},colors:['#090612','#f5f3ff','#c026d3']},
  {id:'aurora',dark:true,name:{English:'Aurora','دری':'شفق قطبی','پښتو':'شفق'},description:{English:'Aurora green and blue glow','دری':'درخشش سبز و آبی شفق','پښتو':'شین او آبي شفق روښانتیا'},colors:['#071a18','#ecfeff','#2dd4bf']},
  {id:'liquidGlass',dark:true,name:{English:'Liquid Glass','دری':'شیشه مایع','پښتو':'مایع ښیښه'},description:{English:'Iridescent cyan glass surfaces','دری':'سطوح شیشه‌ای رنگین و مدرن','پښتو':'رنګین او عصري ښیښه یي سطحې'},colors:['#071a2b','#e0f2fe','#38bdf8']},
]

export const themeInfo = (id: ThemeName) => themes.find(t=>t.id===id) || themes[0]
export const isDarkTheme = (id: ThemeName) => themeInfo(id).dark
