// 主题配色系统
// ---------------------------------------------------------------------------
// 设计令牌（M3 color roles）按「主题 × 明暗模式」在 JS 里注入到 :root 的 CSS 变量上。
//
// 为什么不写好几份 CSS 用 [data-theme] / [data-mode] 属性选择器堆叠：
// 这两种选择器权重相同，暗色 + 非默认主题时会互相覆盖，必须靠源码顺序 + 双属性
// 复合选择器去兜，极易出错。用 JS setProperty 直接写变量，无优先级陷阱，
// 也不会出现切换时的样式闪烁。

// 语义色（危险操作）——与品牌色无关，各主题共用
const ERROR = {
  light: {
    error: '#ba1a1a',
    'on-error': '#ffffff',
    'error-container': '#ffdad6',
    'on-error-container': '#410002'
  },
  dark: {
    error: '#ffb4ab',
    'on-error': '#690005',
    'error-container': '#93000a',
    'on-error-container': '#ffdad6'
  }
}

// 阴影与遮罩：中性，不随主题色变化，只随明暗变
// 阴影：极轻、中性，只表达层级不做装饰。深色下用纯黑压出边界，不发灰。
const ELEV = {
  light: {
    'elev-1': '0 1px 2px rgba(20, 22, 28, 0.05), 0 1px 1px rgba(20, 22, 28, 0.03)',
    'elev-2': '0 4px 12px rgba(20, 22, 28, 0.07), 0 1px 2px rgba(20, 22, 28, 0.04)',
    'elev-3': '0 12px 32px rgba(20, 22, 28, 0.12), 0 2px 8px rgba(20, 22, 28, 0.06)',
    shadow: '#14161c',
    scrim: 'rgba(20, 22, 28, 0.38)'
  },
  dark: {
    'elev-1': '0 1px 2px rgba(0, 0, 0, 0.28)',
    'elev-2': '0 4px 12px rgba(0, 0, 0, 0.36)',
    'elev-3': '0 12px 32px rgba(0, 0, 0, 0.50)',
    shadow: '#000000',
    scrim: 'rgba(0, 0, 0, 0.62)'
  }
}

// 6 套配色，每套都有 light / dark 两版完整令牌
export const THEMES = [
  {
    id: 'indigo',
    name: '靛蓝',
    light: {
      primary: '#4a5bd4',
      'on-primary': '#ffffff',
      'primary-container': '#dee0ff',
      'on-primary-container': '#06164d',
      secondary: '#5b5d72',
      'on-secondary': '#ffffff',
      'secondary-container': '#dfe1f9',
      'on-secondary-container': '#181b2c',
      tertiary: '#775876',
      surface: '#faf8ff',
      'on-surface': '#1b1b21',
      'surface-variant': '#e3e1ec',
      'on-surface-variant': '#46464f',
      'surface-container-low': '#f3f0f9',
      'surface-container': '#edeaf3',
      'surface-container-high': '#e7e4ee',
      'surface-container-highest': '#e1dee9',
      outline: '#777680',
      'outline-variant': '#c7c5d0'
    },
    dark: {
      primary: '#b9c3ff',
      'on-primary': '#1f2a78',
      'primary-container': '#3643a4',
      'on-primary-container': '#dee0ff',
      secondary: '#c3c5dd',
      'on-secondary': '#2c2f42',
      'secondary-container': '#424659',
      'on-secondary-container': '#dfe1f9',
      tertiary: '#e5bad8',
      surface: '#131318',
      'on-surface': '#e4e1e9',
      'surface-variant': '#46464f',
      'on-surface-variant': '#c7c5d0',
      'surface-container-low': '#1b1b21',
      'surface-container': '#1f1f25',
      'surface-container-high': '#2a2931',
      'surface-container-highest': '#35343c',
      outline: '#918f9a',
      'outline-variant': '#46464f'
    }
  },
  {
    id: 'emerald',
    name: '翡翠',
    light: {
      primary: '#1e6b52',
      'on-primary': '#ffffff',
      'primary-container': '#abf2d5',
      'on-primary-container': '#002115',
      secondary: '#4c6358',
      'on-secondary': '#ffffff',
      'secondary-container': '#cfe9da',
      'on-secondary-container': '#092017',
      tertiary: '#3b6470',
      surface: '#f6fbf7',
      'on-surface': '#171d1a',
      'surface-variant': '#dbe5dd',
      'on-surface-variant': '#404944',
      'surface-container-low': '#f0f5f1',
      'surface-container': '#eaefeb',
      'surface-container-high': '#e4e9e5',
      'surface-container-highest': '#dee3df',
      outline: '#707974',
      'outline-variant': '#c0c9c3'
    },
    dark: {
      primary: '#8fd6ba',
      'on-primary': '#00382a',
      'primary-container': '#00513e',
      'on-primary-container': '#abf2d5',
      secondary: '#b3ccbe',
      'on-secondary': '#1f352c',
      'secondary-container': '#354b42',
      'on-secondary-container': '#cfe9da',
      tertiary: '#a5cddb',
      surface: '#101412',
      'on-surface': '#dee4df',
      'surface-variant': '#404944',
      'on-surface-variant': '#bfc9c2',
      'surface-container-low': '#181d1a',
      'surface-container': '#1c211e',
      'surface-container-high': '#262b28',
      'surface-container-highest': '#313633',
      outline: '#8a938d',
      'outline-variant': '#404944'
    }
  },
  {
    id: 'ocean',
    name: '海蓝',
    light: {
      primary: '#00639b',
      'on-primary': '#ffffff',
      'primary-container': '#cee5ff',
      'on-primary-container': '#001d33',
      secondary: '#51606f',
      'on-secondary': '#ffffff',
      'secondary-container': '#d4e4f6',
      'on-secondary-container': '#0e1d2a',
      tertiary: '#6a5b8f',
      surface: '#f7f9ff',
      'on-surface': '#181c20',
      'surface-variant': '#dfe2e8',
      'on-surface-variant': '#43474d',
      'surface-container-low': '#f1f4fa',
      'surface-container': '#ebeef4',
      'surface-container-high': '#e5e8ee',
      'surface-container-highest': '#dfe3e9',
      outline: '#73777d',
      'outline-variant': '#c3c6cc'
    },
    dark: {
      primary: '#96ccff',
      'on-primary': '#003354',
      'primary-container': '#004a76',
      'on-primary-container': '#cee5ff',
      secondary: '#b8c8da',
      'on-secondary': '#233240',
      'secondary-container': '#394857',
      'on-secondary-container': '#d4e4f6',
      tertiary: '#d6bce9',
      surface: '#111418',
      'on-surface': '#e1e2e6',
      'surface-variant': '#43474d',
      'on-surface-variant': '#c3c6cc',
      'surface-container-low': '#191c20',
      'surface-container': '#1d2024',
      'surface-container-high': '#282b2f',
      'surface-container-highest': '#33363a',
      outline: '#8d9197',
      'outline-variant': '#43474d'
    }
  },
  {
    id: 'amber',
    name: '琥珀',
    light: {
      primary: '#7d5700',
      'on-primary': '#ffffff',
      'primary-container': '#ffdea6',
      'on-primary-container': '#271900',
      secondary: '#6c5d3f',
      'on-secondary': '#ffffff',
      'secondary-container': '#f5e0bb',
      'on-secondary-container': '#251a04',
      tertiary: '#4c662b',
      surface: '#fff8f2',
      'on-surface': '#1f1b16',
      'surface-variant': '#ede0cf',
      'on-surface-variant': '#4e4539',
      'surface-container-low': '#fbf2e9',
      'surface-container': '#f5ece3',
      'surface-container-high': '#efe6dd',
      'surface-container-highest': '#e9e0d7',
      outline: '#807568',
      'outline-variant': '#d2c5b4'
    },
    dark: {
      primary: '#f5be48',
      'on-primary': '#412d00',
      'primary-container': '#5e4200',
      'on-primary-container': '#ffdea6',
      secondary: '#d9c3a2',
      'on-secondary': '#3b2f16',
      'secondary-container': '#53462b',
      'on-secondary-container': '#f5e0bb',
      tertiary: '#b1d18a',
      surface: '#15120c',
      'on-surface': '#eae1d9',
      'surface-variant': '#4e4539',
      'on-surface-variant': '#d2c5b4',
      'surface-container-low': '#1d1a14',
      'surface-container': '#211e18',
      'surface-container-high': '#2c2822',
      'surface-container-highest': '#37332d',
      outline: '#9a8f81',
      'outline-variant': '#4e4539'
    }
  },
  {
    id: 'rose',
    name: '玫红',
    light: {
      primary: '#984061',
      'on-primary': '#ffffff',
      'primary-container': '#ffd9e2',
      'on-primary-container': '#3e001d',
      secondary: '#74565f',
      'on-secondary': '#ffffff',
      'secondary-container': '#f2dde3',
      'on-secondary-container': '#2b151c',
      tertiary: '#7d5260',
      surface: '#fff8f8',
      'on-surface': '#201a1b',
      'surface-variant': '#f0dee2',
      'on-surface-variant': '#514347',
      'surface-container-low': '#fdf1f3',
      'surface-container': '#f7ebed',
      'surface-container-high': '#f1e5e7',
      'surface-container-highest': '#ebdfe1',
      outline: '#837377',
      'outline-variant': '#d5c2c6'
    },
    dark: {
      primary: '#ffb0c8',
      'on-primary': '#5e1133',
      'primary-container': '#7b2949',
      'on-primary-container': '#ffd9e2',
      secondary: '#e2bdc6',
      'on-secondary': '#422931',
      'secondary-container': '#5a3f47',
      'on-secondary-container': '#f2dde3',
      tertiary: '#efb8c8',
      surface: '#191113',
      'on-surface': '#ede0e2',
      'surface-variant': '#514347',
      'on-surface-variant': '#d5c2c6',
      'surface-container-low': '#211a1c',
      'surface-container': '#251e20',
      'surface-container-high': '#30282a',
      'surface-container-highest': '#3b3335',
      outline: '#9e8c90',
      'outline-variant': '#514347'
    }
  },
  {
    id: 'violet',
    name: '紫罗兰',
    light: {
      primary: '#6a4fa8',
      'on-primary': '#ffffff',
      'primary-container': '#eaddff',
      'on-primary-container': '#22005d',
      secondary: '#635b70',
      'on-secondary': '#ffffff',
      'secondary-container': '#e9def8',
      'on-secondary-container': '#1e192b',
      tertiary: '#7c5266',
      surface: '#fdf7ff',
      'on-surface': '#1c1b20',
      'surface-variant': '#e7e0eb',
      'on-surface-variant': '#48454e',
      'surface-container-low': '#f7f1fb',
      'surface-container': '#f1ebf5',
      'surface-container-high': '#ebe5ef',
      'surface-container-highest': '#e5dfe9',
      outline: '#79757f',
      'outline-variant': '#cac4cf'
    },
    dark: {
      primary: '#cfbcff',
      'on-primary': '#381e72',
      'primary-container': '#4f378b',
      'on-primary-container': '#eaddff',
      secondary: '#cdc2db',
      'on-secondary': '#342d41',
      'secondary-container': '#4a4358',
      'on-secondary-container': '#e9def8',
      tertiary: '#efb8d4',
      surface: '#141218',
      'on-surface': '#e6e0e9',
      'surface-variant': '#48454e',
      'on-surface-variant': '#cac4cf',
      'surface-container-low': '#1c1a20',
      'surface-container': '#201e25',
      'surface-container-high': '#2b2930',
      'surface-container-highest': '#36343b',
      outline: '#938f99',
      'outline-variant': '#48454e'
    }
  }
]

export const DEFAULT_THEME = 'indigo'
export const DEFAULT_MODE = 'light'

export function isThemeId(id) {
  return THEMES.some((t) => t.id === id)
}

export function getTheme(id) {
  return THEMES.find((t) => t.id === id) || THEMES[0]
}

// ---------------------------------------------------------------------------
// v0.3 「中性软表面」：Windows / macOS 共用同一套中性分层，不依赖任何平台材质
// （Mica / Vibrancy / 毛玻璃都不用），所以两个平台看起来几乎一样。
// 6 套主题在这里收敛成 6 种强调色 —— 中性底共用，主题只换一个色相，
// 切主题不会把界面层级也一起换掉。
// ---------------------------------------------------------------------------
const NEUTRAL = {
  light: {
    surface: '#f3f0fb',
    'on-surface': '#2b2540',
    'surface-variant': '#e9e2fa',
    'on-surface-variant': '#6b6285',
    'surface-container-low': 'rgba(255, 255, 255, 0.55)',
    'surface-container': 'rgba(255, 255, 255, 0.68)',
    'surface-container-high': 'rgba(255, 255, 255, 0.80)',
    'surface-container-highest': 'rgba(255, 255, 255, 0.92)',
    outline: '#8b7fb0',
    'outline-variant': 'rgba(122, 92, 255, 0.16)'
  },
  dark: {
    surface: '#171522',
    'on-surface': '#f0ecfa',
    'surface-variant': '#2e2a3d',
    'on-surface-variant': '#b4abc9',
    'surface-container-low': 'rgba(255, 255, 255, 0.045)',
    'surface-container': 'rgba(255, 255, 255, 0.06)',
    'surface-container-high': 'rgba(255, 255, 255, 0.09)',
    'surface-container-highest': 'rgba(255, 255, 255, 0.12)',
    outline: '#8f86a8',
    'outline-variant': 'rgba(180, 160, 255, 0.18)'
  }
}

// 柔光玻璃：光晕、玻璃层、亮边、柔和投影。
// ⚠️ 全部是应用内纯 CSS，不用 setBackgroundMaterial / vibrancy / backdrop-filter
// —— 那类系统材质在 Win/Mac 表现不同，而且会透出深色壁纸发灰（mini 版踩过）。
// 这样两端渲染的是同一套渐变，观感一致，底色也始终是明亮的浅紫白。
const GLASS = {
  light: {
    'glow-a': 'radial-gradient(58% 52% at 8% 2%, rgba(196, 168, 255, 0.55) 0%, rgba(196, 168, 255, 0) 100%)',
    'glow-b': 'radial-gradient(52% 48% at 96% 96%, rgba(150, 205, 255, 0.48) 0%, rgba(150, 205, 255, 0) 100%)',
    'glow-c': 'radial-gradient(40% 38% at 68% 6%, rgba(255, 190, 225, 0.34) 0%, rgba(255, 190, 225, 0) 100%)',
    glass: 'rgba(255, 255, 255, 0.62)',
    'glass-strong': 'rgba(255, 255, 255, 0.84)',
    'glass-line': 'rgba(255, 255, 255, 0.92)',
    'glass-shadow': '0 8px 28px rgba(88, 70, 150, 0.10), 0 1px 2px rgba(88, 70, 150, 0.06)',
    'glass-shadow-hover': '0 14px 36px rgba(88, 70, 150, 0.16), 0 2px 6px rgba(88, 70, 150, 0.08)'
  },
  dark: {
    'glow-a': 'radial-gradient(58% 52% at 8% 2%, rgba(110, 80, 190, 0.42) 0%, rgba(110, 80, 190, 0) 100%)',
    'glow-b': 'radial-gradient(52% 48% at 96% 96%, rgba(40, 110, 170, 0.34) 0%, rgba(40, 110, 170, 0) 100%)',
    'glow-c': 'radial-gradient(40% 38% at 68% 6%, rgba(170, 70, 140, 0.22) 0%, rgba(170, 70, 140, 0) 100%)',
    glass: 'rgba(255, 255, 255, 0.06)',
    'glass-strong': 'rgba(255, 255, 255, 0.11)',
    'glass-line': 'rgba(255, 255, 255, 0.15)',
    'glass-shadow': '0 8px 28px rgba(0, 0, 0, 0.28)',
    'glass-shadow-hover': '0 14px 36px rgba(0, 0, 0, 0.42)'
  }
}

function modernVars(themeId, mode) {
  const theme = getTheme(themeId)
  const m = mode === 'dark' ? 'dark' : 'light'
  const n = NEUTRAL[m]
  const accent = theme[m].primary // 各主题原本就按明暗调过亮度，直接拿来当强调色
  return {
    ...n,
    ...GLASS[m],
    primary: accent,
    'on-primary': m === 'dark' ? '#10131a' : '#ffffff',
    'primary-container': `color-mix(in srgb, ${accent} 12%, var(--md-surface))`,
    'on-primary-container': n['on-surface'],
    secondary: n['on-surface-variant'],
    'on-secondary': m === 'dark' ? '#15171b' : '#ffffff',
    'secondary-container': `color-mix(in srgb, ${accent} 9%, var(--md-surface))`,
    'on-secondary-container': n['on-surface'],
    tertiary: accent,
    'on-tertiary': m === 'dark' ? '#10131a' : '#ffffff',
    ...ERROR[m],
    ...ELEV[m]
  }
}

// 设置面板的色板预览也走同一套合成，预览与实际应用不会出现两套颜色
export function paletteOf(id, mode) {
  return modernVars(id, mode)
}

// 整套令牌写到 :root，切换立即生效且不会闪
export function applyTheme(themeId, mode) {
  const m = mode === 'dark' ? 'dark' : 'light'
  const vars = modernVars(themeId, m)
  const root = document.documentElement
  for (const key of Object.keys(vars)) {
    root.style.setProperty('--md-' + key, vars[key])
  }
  root.dataset.theme = getTheme(themeId).id
  root.dataset.mode = m
  root.style.colorScheme = m
}
