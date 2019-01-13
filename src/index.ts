import generate from '@babel/generator'
import babelTraverse, { NodePath } from '@babel/traverse'
import * as t from '@babel/types'
import * as babelParser from '@babel/parser'
import * as fs from 'fs'
import { parseComponent } from 'vue-template-compiler'
import { initComponents, initComputed, initData, initProps } from './collect-state'
import { log, parseComponentName, parseName } from './utils'

import { genClassMethods, genImports, genProps, genComputeds, genDatas } from './tsvue-ast-helpers'

import output from './output'
import { handleCycleMethods, handleGeneralMethods } from './vue-ast-helpers'

export type CollectStateDatas = {
  [key: string]: NodePath[]
}

export type CollectState = {
  name: string | void
  data: CollectStateDatas
  dataStatements: t.Statement[]
  props: any
  computeds: any
  components: any
}

const state: CollectState = {
  name: undefined,
  data: {},
  dataStatements: [],
  props: {},
  computeds: {},
  components: {},
}

// Life-cycle methods relations mapping
const cycle = {
  created: 'componentWillMount',
  mounted: 'componentDidMount',
  updated: 'componentDidUpdate',
  beforeDestroy: 'componentWillUnmount',
  errorCaptured: 'componentDidCatch',
  render: 'render',
}

const collect = {
  imports: [],
  classMethods: {},
}

function formatContent(source, isSFC) {
  if (isSFC) {
    const res = parseComponent(source, { pad: 'line' })
    return {
      template: res.template.content.replace(/{{/g, '{').replace(/}}/g, '}'),
      js: res.script.content.replace(/\/\//g, ''),
    }
  } else {
    return {
      template: null,
      js: source,
    }
  }
}

export default function transform(src, targetPath, isSFC) {
  const source = fs.readFileSync(src)
  const component = formatContent(source.toString(), isSFC)

  const vast = babelParser.parse(component.js, {
    sourceType: 'module',
    plugins: isSFC ? [] : ['jsx'],
  })

  initProps(vast, state)
  initData(vast, state)
  initComputed(vast, state)
  initComponents(vast, state) // SFC

  babelTraverse(vast, {
    ImportDeclaration(path: NodePath) {
      collect.imports.push(path.node)
    },

    ObjectMethod(path: NodePath) {
      const name = path.node.key.name
      if (path.parentPath.parent.key && path.parentPath.parent.key.name === 'methods') {
        handleGeneralMethods(path, collect, state, name)
      } else if (cycle[name]) {
        handleCycleMethods(path, collect, state, name, cycle[name], isSFC)
      } else {
        if (name === 'data' || state.computeds[name]) {
          return
        }
        log(`The ${name} method maybe be not support now`)
      }
    },
  })

  // AST for react component
  const scriptTpl = `export default class ${parseName(state.name)} extends Vue {}`
  const scriptAst = babelParser.parse(scriptTpl, {
    sourceType: 'module',
    plugins: isSFC ? [] : ['jsx'],
  })

  babelTraverse(scriptAst, {
    Program(path) {
      genImports(path, collect, state)
    },

    ClassBody(path) {
      genProps(path, state)
      genDatas(path, state)
      genComputeds(path, state)
      genClassMethods(path, collect)
    },
  })


  const r = generate(scriptAst, {
    quotes: 'single',
    retainLines: true,
  })
  const scriptCode = r.code

  output({
    scriptCode,
    isSFC,
    templateCode: component.template,
    dist: targetPath
  })

  log('Transform success', 'success')
}
