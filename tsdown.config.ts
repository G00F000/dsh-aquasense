/**
 * 构建配置:仅打包浏览器半侧 dist/client.js。
 *
 * Host 半侧由 tsc 编译多文件产物(见 package.json build 脚本:tsc → dist/),
 * 因此这里 clean: false,避免清掉 tsc 输出;client bundle 输出为 DSH
 * module-loader 包裹的 CJS:
 *   window.__ModuleLoader__.load({ id, factory: (require) => { ... } })
 * id 必须与 package.json name 一致(宿主按包名解析 /plugins bundle)。
 *
 * 平台模块(React / cordis / client-store)保持 external,由加载器模块表在
 * 运行时提供;其余全部内联(dsh.client.external 未声明额外请求)。
 */
import { defineConfig, type UserConfig } from 'tsdown'

const ID = 'dsh-aquasense'

/** 浏览器 bundle 外部化的平台模块(DSH module-loader 模块表提供) */
const CLIENT_EXTERNALS = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-store'
]

const client: UserConfig = {
  name: `${ID}/client`,
  entry: { client: 'src/client/index.ts' },
  outDir: 'dist',
  format: ['cjs'],
  platform: 'browser',
  target: 'es2024',
  dts: false,
  sourcemap: true,
  clean: false,
  external: CLIENT_EXTERNALS,
  noExternal: (id: string) => (CLIENT_EXTERNALS.includes(id) ? undefined : true),
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production')
  },
  outputOptions: {
    entryFileNames: 'client.js',
    banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(ID)}, factory: (require) => {`,
    footer: 'return module.exports; } });',
    intro: 'var module = { exports: {} }; var exports = module.exports;'
  }
}

export default defineConfig([client])
