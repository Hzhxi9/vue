/* @flow */

import { genHandlers } from "./events";
import baseDirectives from "../directives/index";
import { camelize, no, extend } from "shared/util";
import { baseWarn, pluckModuleFunction } from "../helpers";
import { emptySlotScopeToken } from "../parser/index";

type TransformFunction = (el: ASTElement, code: string) => string;
type DataGenFunction = (el: ASTElement) => string;
type DirectiveFunction = (
  el: ASTElement,
  dir: ASTDirective,
  warn: Function
) => boolean;

export class CodegenState {
  options: CompilerOptions;
  warn: Function;
  transforms: Array<TransformFunction>;
  dataGenFns: Array<DataGenFunction>;
  directives: { [key: string]: DirectiveFunction };
  maybeComponent: (el: ASTElement) => boolean;
  onceId: number;
  staticRenderFns: Array<string>;
  pre: boolean;

  constructor(options: CompilerOptions) {
    this.options = options;
    /**警告日志输出函数 */
    this.warn = options.warn || baseWarn;

    /*
     * 为虚拟dom添加基本需要的属性
     * modules=modules$1=[
     *   {staticKeys: ['staticClass'], transformNode: transformNode, genData: genData},  // class 转换函数
     *   {staticKeys: ['staticStyle'], transformNode: transformNode$1, genData: genData$1 } //style 转换函数
     *   {preTransformNode: preTransformNode}
     * ]
     *
     * 循环过滤数组或者对象的值，根据key循环 过滤对象或者数组[key]值，如果不存在则丢弃，如果有相同多个的key值，返回多个值的数组
     * 这里返回是空
     */
    this.transforms = pluckModuleFunction(options.modules, "transformCode");

    /**
     * 获取到一个数组，数组中有两个函数genData和genData$1
     */
    this.dataGenFns = pluckModuleFunction(options.modules, "genData");

    /**
     * web平台  '../web/platform/compiler/directives'
     * options.directives= {
     *    model: model, //根据判断虚拟dom的标签类型是什么？给相应的标签绑定 相应的 v-model 双数据绑定代码函数
     *    text: text, // 为虚拟dom添加textContent 属性
     *    html: html//  为虚拟dom添加innerHTML 属性
     * }
     *
     * 基本指令参数
     * var baseDirectives = {on: on, //包装事件  bind: bind$1, //包装数据  cloak: noop //空函数 }
     *
     * 扩展指令，on,bind,cloak方法
     */
    this.directives = extend(extend({}, baseDirectives), options.directives);

    /**留标签 判断是不是真的是 html 原有的标签 或者svg标签 */
    const isReservedTag = options.isReservedTag || no;

    /**也许是组件 */
    this.maybeComponent = (el: ASTElement) =>
      !!el.component || !isReservedTag(el.tag);
    this.onceId = 0;

    /**静态渲染方法,存放生成静态渲染函数 */
    this.staticRenderFns = [];
    this.pre = false;
  }
}

export type CodegenResult = {
  render: string,
  staticRenderFns: Array<string>,
};

/**
 * 从AST生成渲染函数
 * @param {*} ast ast对象
 * @param {*} options 编译选项
 * @returns  { render: `with(this){return _c(tag, data, children) }`, staticRenderFns: state.staticRenderFns }
 */
export function generate(
  ast: ASTElement | void,
  options: CompilerOptions
): CodegenResult {
  /**
   * 实例化CodegenState类， 参数是编译选项，最终得到state大部分属性和options一样， 生成代码的时候需要用其中一些东西
   *
   * state.staticRenderFns = [], state.directives
   *
   * 生成状态
   * 1. 扩展指令，on,bind，cloak,方法
   * 2. dataGenFns 获取到一个数组，数组中有两个函数genData和genData$1
   */
  const state = new CodegenState(options);

  /**
   * fix #11483, Root level <script> tags should not be rendered.
   *
   * 得到生成字符串格式的代码， 比如'_c(tag, data, children, normalizationType)'
   *
   * data为节点上的属性组成的JSON字符串， 比如"{ key: xx, ref: xx, ... }"
   * children 为所有子节点的字符串格式的代码组成的字符串数据， 格式：
   *   `['_c(tag, data, children,)',...], normalizationType`,
   *   最后的normalization 是_c的第四个参数
   *   表示即诶单的规范化类型， 不是重点， 不需要关注
   *
   * 当然code并不一定就是_c, 也有可能是其他的，比如整个组件都是静态的, 则结果就为_m(0)
   *
   * 根据el判断是否是组件，或者是否含有v-once，v-if,v-for,是否有template属性，或者是slot插槽，转换style，css等转换成虚拟dom需要渲染的参数函数
   */
  const code = ast
    ? ast.tag === "script"
      ? "null"
      : genElement(ast, state)
    : '_c("div")';

  return {
    /**with 绑定js的this 缩写，动态节点的渲染函数 */
    render: `with(this){return ${code}}`,
    /**存放所有静态节点渲染函数的数组*/
    staticRenderFns: state.staticRenderFns,
  };
}

/**
 * 初始化扩展指令，on,bind，cloak,方法， dataGenFns 获取到一个数组，数组中有两个函数genData和genData$1
 * genElement根据el判断是否是组件，或者是否含有v-once，v-if,v-for,是否有template属性，或者是slot插槽，转换style，css等转换成虚拟dom需要渲染的参数函数
 *
 * 处理ast对象，得到一个可执行函数的字符串形式
 * 比如 _c(tag, data, children, normalizationType)
 * @param {*} el ast对象或者虚拟dom
 * @param {*} state 渲染虚拟dom的一些方法
 * @returns
 */
export function genElement(el: ASTElement, state: CodegenState): string {
  if (el.parent) {
    el.pre = el.pre || el.parent.pre;
  }

  if (el.staticRoot && !el.staticProcessed) {
    /**
     * idx 是当前静态节点的渲染函数在staticRenderFns数组中的下标
     *
     * 处理静态根节点， 生成节点的渲染函数
     *    1. 将当前静态节点的渲染函数放到staticRenderFns数组中
     *    2. 返回一个可执行函数_m(idx, true or '')
     */
    return genStatic(el, state);
  } else if (el.once && !el.onceProcessed) {
    /**
     * 不需要表达式
     * 详细：只渲染元素和组件一次。随后的重新渲染，元素/组件及其所有的子节点将被视为静态内容并跳过。这可以用于优化更新性能
     *
     * 处理带有v-once指令的节点， 结果会有三种：
     *    1. 当前节点存在v-if指令，得到一个三元表达式， condition? render1: render2
     *    2. 当前节点是一个包含在v-for指令内部的静态节点，得到`_o(_c(tag, data, children), number, key)`
     *    3. 当前节点就是一个单纯的v-once节点，得到`_m(idx, true or '')`
     */
    return genOnce(el, state);
  } else if (el.for && !el.forProcessed) {
    /**
     * 处理节点上的v-for指令
     * 得到`_l(exp, function(alias, iterator1, iterator2){ return _c(tag, data, children)})`
     */
    return genFor(el, state);
  } else if (el.if && !el.ifProcessed) {
    /**
     * 处理带有v-if指令的节点
     * 最终得到一个三元表达式: condition? render1: render2
     */
    return genIf(el, state);
  } else if (el.tag === "template" && !el.slotTarget && !state.pre) {
    /**
     * 当前节点不是template标签也不是插槽和带有v-pre指令的节点
     * 生成所有子节点的渲染函数，返回一个数组
     * 格式如[_c(tag, data, children), ...],normalizationType
     */
    return genChildren(el, state) || "void 0";
  } else if (el.tag === "slot") {
    /**
     * 生成插槽和渲染函数
     * 得到_t(slotName, children, attrs, bind)
     */
    return genSlot(el, state);
  } else {
    /**
     * component or element
     * 处理动态组件和普通元素(自定义组件、原生标签)
     */
    let code;
    if (el.component) {
      /**
       * 处理动态组件，生成动态组件的渲染函数
       * 得到`_c(compName, data, children)`
       */
      code = genComponent(el.component, el, state);
    } else {
      /**
       * 自定义组件和元素标签
       */
      let data;
      if (!el.plain || (el.pre && state.maybeComponent(el))) {
        /**
         * 非普通元素或者带有v-pre指令的组件，处理节点的所有属性，返回一个JSON字符串
         * 比如 '{key: xx, ref: xx, ....}'
         */
        data = genData(el, state);
      }

      /**
       * 处理子节点，得到所有子节点字符串格式代码组成的数组
       * 格式： `['_c(tag, data, children)', ...], normalizationType`
       * 最后的normalization 表示节点的规范化类型， 不是重点， 不需要关注
       */
      const children = el.inlineTemplate ? null : genChildren(el, state, true);

      /**
       * 得到最终的字符串格式的代码
       * 格式 `_c(tag, data, children, normalizationType)`
       */
      code = `_c('${el.tag}'${
        data ? `,${data}` : "" // data
      }${
        children ? `,${children}` : "" // children
      })`;
    }
    /**
     * module transforms
     * 分别为code执行transformNode 方法
     *
     * 如果提供了transformCode 方法
     * 则最终的code 会经过各个模块(module)的该方法处理
     * 不过框架没提供这个方法，不过即使处理了，最终的格式也是 _c(tag, data, children)
     */
    for (let i = 0; i < state.transforms.length; i++) {
      code = state.transforms[i](el, code);
    }
    return code;
  }
}

/**
 * hoist static sub-trees out
 *
 * 处理静态节点，生成静态节点的渲染函数
 *  1. 将当前静态节点的渲染函数放到staticRenderFns数组中
 *  2. 返回一个可执行函数 _m(idx, true or '')
 * @param {*} el
 * @param {*} state
 * @returns
 */
function genStatic(el: ASTElement, state: CodegenState): string {
  /**标记当前静态节点已经被处理过了 */
  el.staticProcessed = true;
  // Some elements (templates) need to behave differently inside of a v-pre
  // node.  All pre nodes are static roots, so we can use this as a location to
  // wrap a state change and reset it upon exiting the pre node.
  const originalPreState = state.pre;
  if (el.pre) {
    state.pre = el.pre;
  }
  /**
   * 调用genElement方法得到静态节点的渲染函数，包装成`with(this){return _c(tag, data, children, normalizationType)}`
   *
   * 将静态根节点的渲染函数push到staticRenderFns数组中
   * 比如[`with(this){return _c(tag, data, children)}`]
   */
  state.staticRenderFns.push(`with(this){return ${genElement(el, state)}}`);
  state.pre = originalPreState;

  /**
   * 返回一个可执行函数: _m(idx, true or '')
   * idx = 当前静态节点的渲染函数在staticRenderFns数组中的下标
   * el.staticInFor 当前节点是否被包裹在v-for中
   */
  return `_m(${state.staticRenderFns.length - 1}${
    el.staticInFor ? ",true" : ""
  })`;
}

/**
 * v-once
 * 处理带有v-once指令的节点， 结果会有三种：
 *   1. 当前节点存在v-if指令，得到一个三元表达式， condition? render1: render2
 *   2. 当前节点是一个包含在v-for指令内部的静态节点，得到`_o(_c(tag, data, children), number, key)`
 *   3. 当前节点就是一个单纯的v-once节点，得到`_m(idx, true or '')`
 * @param {*} el
 * @param {*} state
 * @returns
 */
function genOnce(el: ASTElement, state: CodegenState): string {
  /**标记当前节点的v-once指令已经被处理过了 */
  el.onceProcessed = true;
  if (el.if && !el.ifProcessed) {
    /**
     * 处理带有v-if指令并且v-if指令没有被处理过的节点
     * 处理带有 v-if 指令的节点，最终得到一个三元表达式，condition ? render1 : render2
     */
    return genIf(el, state);
  } else if (el.staticInFor) {
    /**
     * 说明当前节点是被包裹在还有 v-for 指令节点内部的静态节点
     */
    let key = ""; /**获取 v-for 指令的 key */
    let parent = el.parent;
    while (parent) {
      if (parent.for) {
        key = parent.key;
        break;
      }
      parent = parent.parent;
    }
    if (!key) {
      /**key 不存在则给出提示，v-once 节点只能用于带有 key 的 v-for 节点内部 */
      process.env.NODE_ENV !== "production" &&
        state.warn(
          `v-once can only be used inside v-for that is keyed. `,
          el.rawAttrsMap["v-once"]
        );
      return genElement(el, state);
    }
    /**生成 `_o(_c(tag, data, children), number, key)` */
    return `_o(${genElement(el, state)},${state.onceId++},${key})`;
  } else {
    /**
     * 上面几种情况都不符合，说明就是一个简单的静态节点，和处理静态根节点时的操作一样,
     * 得到 _m(idx, true or '')
     */
    return genStatic(el, state);
  }
}

/**
 * 处理带有 v-if 指令的节点，最终得到一个三元表达式，condition ? render1 : render2
 * @param {*} el
 * @param {*} state
 * @param {*} altGen
 * @param {*} altEmpty
 * @returns
 */
export function genIf(
  el: any,
  state: CodegenState,
  altGen?: Function,
  altEmpty?: string
): string {
  /**标记当前节点的 v-if 指令已经被处理过了，避免无效的递归 */
  el.ifProcessed = true; // avoid recursion

  /**
   * el.ifConditions = [{ exp, block }]
   * 得到三元表达式，condition ? render1 : render2
   **/
  return genIfConditions(el.ifConditions.slice(), state, altGen, altEmpty);
}

function genIfConditions(
  conditions: ASTIfConditions,
  state: CodegenState,
  altGen?: Function,
  altEmpty?: string
): string {
  /**长度若为空，则直接返回一个空节点渲染函数 */
  if (!conditions.length) {
    return altEmpty || "_e()";
  }

  /**从 conditions 数组中拿出第一个条件对象 { exp, block } */
  const condition = conditions.shift();

  /**返回结果是一个三元表达式字符串，condition ? 渲染函数1 : 渲染函数2 */
  if (condition.exp) {
    /**
     * 判断if指令参数是否存在 如果存在则递归condition.block 数据此时ifProcessed 变为true 下次不会再进来
     *
     * 如果 condition.exp 条件成立，则得到一个三元表达式，
     * 如果条件不成立，则通过递归的方式找 conditions 数组中下一个元素，
     * 直到找到条件成立的元素，然后返回一个三元表达式
     */
    return `(${condition.exp})?${genTernaryExp(
      condition.block
    )}:${genIfConditions(conditions, state, altGen, altEmpty)}`;
  } else {
    return `${genTernaryExp(condition.block)}`;
  }

  // v-if with v-once should generate code like (a)?_m(0):_m(1)
  function genTernaryExp(el) {
    return altGen
      ? altGen(el, state)
      : el.once
      ? genOnce(el, state)
      : genElement(el, state);
  }
}

/**
 * 处理节点上的 v-for 指令
 * 得到`_l(exp, function(alias, iterator1, iterator2){ return _c(tag, data, children)})`
 * @param {*} el
 * @param {*} state
 * @param {*} altGen
 * @param {*} altHelper
 * @returns
 */
export function genFor(
  el: any,
  state: CodegenState,
  altGen?: Function,
  altHelper?: string
): string {
  /**v-for 的迭代器，比如 一个数组 */
  const exp = el.for;

  /**迭代时的别名 */
  const alias = el.alias;

  /**iterator 为 v-for = "(item ,idx) in obj" 时会有，比如 iterator1 = idx */
  const iterator1 = el.iterator1
    ? `,${el.iterator1}`
    : ""; /**iterator1: "index" 索引 */

  const iterator2 = el.iterator2
    ? `,${el.iterator2}`
    : ""; /**iterator2: "key" */

  if (
    process.env.NODE_ENV !== "production" &&
    state.maybeComponent(el) &&
    el.tag !== "slot" &&
    el.tag !== "template" &&
    !el.key
  ) {
    /**提示，v-for 指令在组件上时必须使用 key */
    state.warn(
      `<${el.tag} v-for="${alias} in ${exp}">: component lists rendered with ` +
        `v-for should have explicit keys. ` +
        `See https://vuejs.org/guide/list.html#key for more info.`,
      el.rawAttrsMap["v-for"],
      true /* tip */
    );
  }
  /**标记当前节点上的 v-for 指令已经被处理过了 */
  el.forProcessed = true; // avoid recursion

  /**得到 `_l(exp, function(alias, iterator1, iterator2){return _c(tag, data, children)})` */
  return (
    `${altHelper || "_l"}((${exp}),` +
    `function(${alias}${iterator1}${iterator2}){` +
    `return ${(altGen || genElement)(el, state)}` +
    "})"
  );
}

/**
 * 处理节点上的众多属性，最后生成这些属性组成的 JSON 字符串，比如 data = { key: xx, ref: xx, ... }
 * @param {*} el
 * @param {*} state
 * @returns
 */
export function genData(el: ASTElement, state: CodegenState): string {
  /**节点的属性组成的 JSON 字符串 */
  let data = "{";

  /**
   *  directives first.
   *  directives may mutate the el's other properties before they are generated.
   *
   *  首先先处理指令，因为指令可能在生成其它属性之前改变这些属性
   *  执行指令编译方法，比如 web 平台的 v-text、v-html、v-model，然后在 el 对象上添加相应的属性，
   *  比如 v-text： el.textContent = _s(value, dir) ,  v-html：el.innerHTML = _s(value, dir)
   *
   *  指令在运行时还有任务时，比如 v-model，则返回 directives: [{ name, rawName, value, arg, modifiers }, ...}]
   */
  const dirs = genDirectives(el, state);
  if (dirs) {
    /**
     * directives
     * data = { directives: [{ name, rawName, value, arg, modifiers }, ...}] }
     */
    data += dirs + ",";
  }

  /**
   * key
   * data = { key: xx }
   */
  if (el.key) {
    data += `key:${el.key},`;
  }

  /**
   * ref
   * data = { ref: xx }
   */
  if (el.ref) {
    data += `ref:${el.ref},`;
  }

  /**
   * 带有 ref 属性的节点在带有 v-for 指令的节点的内部， data = { refInFor: true }
   */
  if (el.refInFor) {
    data += `refInFor:true,`;
  }

  /**
   * pre
   * v-pre 指令，data = { pre: true }
   */
  if (el.pre) {
    data += `pre:true,`;
  }

  /**
   * record original tag name for components using "is" attribute
   * 动态组件，data = { tag: 'component' }
   */
  if (el.component) {
    data += `tag:"${el.tag}",`;
  }

  /**
   * 为节点执行模块(class、style)的 genData 方法，处理节点上的style和class
   * 得到 data = { staticClass: xx, class: xx, staticStyle: xx, style: xx }
   * module data generation functions
   */
  for (let i = 0; i < state.dataGenFns.length; i++) {
    data += state.dataGenFns[i](el);
  }

  /**
   * attributes
   * 处理其它属性
   * 只有静态属性时: data = { attrs: 'attrName:attrValue, ...' }
   * 存在动态属性时: data = { attrs: `_d(staticProps, [dAttrName, aAttrValue, ...])` }
   */
  if (el.attrs) {
    data += `attrs:${genProps(el.attrs)},`;
  }

  /**
   * DOM props 结果同 el.attrs
   */
  if (el.props) {
    data += `domProps:${genProps(el.props)},`;
  }

  /**
   * event handlers
   * 处理不带有native修饰符的事件
   * 动态: data = { on:_d(staticHandles, [dynamicHandlers]) }
   * 静态: 直接返回 data = {`on:${staticHandles}`}
   */
  if (el.events) {
    data += `${genHandlers(el.events, false)},`;
  }

  /**
   * 带 .native 修饰符的事件，
   * 动态: data = { nativeOn:_d(staticHandles, [dynamicHandlers]) }
   * 静态: 直接返回 data = {`nativeOn:${staticHandles}`}
   */
  if (el.nativeEvents) {
    data += `${genHandlers(el.nativeEvents, true)},`;
  }

  /**
   * slot target
   * only for non-scoped slots
   * 非作用域插槽，得到 data = { slot: slotName }
   */
  if (el.slotTarget && !el.slotScope) {
    data += `slot:${el.slotTarget},`;
  }

  /**
   * scoped slots
   * 作用域插槽，data = { scopedSlots: '_u(xxx)' }
   */
  if (el.scopedSlots) {
    data += `${genScopedSlots(el, el.scopedSlots, state)},`;
  }

  /**
   *  component v-model
   *  处理 v-model指令的组件，得到 data = { model: { value, callback, expression } }
   */
  if (el.model) {
    data += `model:{value:${el.model.value},callback:${el.model.callback},expression:${el.model.expression}},`;
  }

  /**
   * inline-template，处理内联模版，得到
   * data = { inlineTemplate: { render: function() { render 函数 }, staticRenderFns: [ function() {}, ... ] } }
   */
  if (el.inlineTemplate) {
    const inlineTemplate = genInlineTemplate(el, state);
    if (inlineTemplate) {
      data += `${inlineTemplate},`;
    }
  }

  /**
   * 删掉 JSON 字符串最后的 逗号，然后加上闭合括号 }
   */
  data = data.replace(/,$/, "") + "}";
  // v-bind dynamic argument wrap
  // v-bind with dynamic arguments must be applied using the same v-bind object
  // merge helper so that class/style/mustUseProp attrs are handled correctly.
  if (el.dynamicAttrs) {
    /**存在动态属性，data = `_b(data, tag, 静态属性字符串或者_d(静态属性字符串, 动态属性字符串))` */
    data = `_b(${data},"${el.tag}",${genProps(el.dynamicAttrs)})`;
  }
  // v-bind data wrap
  if (el.wrapData) {
    data = el.wrapData(data);
  }
  // v-on data wrap
  if (el.wrapListeners) {
    data = el.wrapListeners(data);
  }
  return data;
}

/**
 * 运行指令的编译方法，如果指令存在运行时任务，则返回 directives: [{ name, rawName, value, arg, modifiers }, ...}]
 *
 * 初始化指令属性参数,把ast对象中的指令属性对象提取出来成数组只保留name和rawName这两个key 比如<div v-info></div> 则变成 directives:[{name:"info",rawName:"v-info"}]
 * @param {*} el
 * @param {*} state
 * @returns
 */
function genDirectives(el: ASTElement, state: CodegenState): string | void {
  /**
   * 获取指令数组
   * el.directives: [{ name, rawName, value, arg, isDynamicArg, modifiers, start, end }],
   **/
  const dirs = el.directives;

  /**没有指令则直接结束 */
  if (!dirs) return;

  /**指令的处理结果 */
  let res = "directives:[";

  /**标记，用于标记指令是否需要在运行时完成的任务，比如 v-model 的 input 事件 */
  let hasRuntime = false;
  let i, l, dir, needRuntime;

  /**
   * 为虚拟dom 添加一个 指令directives属性 对象
   *  addDirective(
   *    el, //虚拟dom vonde
   *    name, //获取 view 原始属性的名称 不包含 v- : @的
   *    rawName,// 获取 view 原始属性的名称 包含 v- : @的
   *    value, // 属性view 属性上的值
   *    arg, // efg:hig 属性名称冒号后面多出来的标签
   *    modifiers
   *  );
   **/

  /**遍历指令数组 */
  for (i = 0, l = dirs.length; i < l; i++) {
    /**一个虚拟dom可能会有能绑定多个指令 */
    dir = dirs[i];
    needRuntime = true;
    /**
     * 获取节点当前指令的处理方法
     * 比如 web 平台的 v-html、v-text、v-model
     * dir.name = text(v-text)
     **/
    const gen: DirectiveFunction = state.directives[dir.name];
    if (gen) {
      /**
       * 执行指令的编译方法，如果指令还需要运行时完成一部分任务，则返回 true，比如 v-model
       * compile-time directive that manipulates AST.
       * returns true if it also needs a runtime counterpart.
       */
      needRuntime = !!gen(el, dir, state.warn);
    }
    if (needRuntime) {
      /**
       * 表示该指令在运行时还有任务
       * 比如v-model得到最终结果并 return 出去
       * res = 'directives:[{ name, rawName, value, arg, isDynamicArg, modifiers, start, end },...]'
       */
      hasRuntime = true;
      res += `{name:"${dir.name}",rawName:"${dir.rawName}"${
        dir.value
          ? `,value:(${dir.value}),expression:${JSON.stringify(dir.value)}`
          : ""
      }${dir.arg ? `,arg:${dir.isDynamicArg ? dir.arg : `"${dir.arg}"`}` : ""}${
        dir.modifiers ? `,modifiers:${JSON.stringify(dir.modifiers)}` : ""
      }},`;
    }
  }
  if (hasRuntime) {
    /**也就是说，只有指令存在运行时任务时，才会返回 res(把res最后的,删除， 加上])  */
    return res.slice(0, -1) + "]";
  }
}

function genInlineTemplate(el: ASTElement, state: CodegenState): ?string {
  const ast = el.children[0];
  if (
    process.env.NODE_ENV !== "production" &&
    (el.children.length !== 1 || ast.type !== 1)
  ) {
    state.warn(
      "Inline-template components must have exactly one child element.",
      { start: el.start }
    );
  }
  if (ast && ast.type === 1) {
    const inlineRenderFns = generate(ast, state.options);
    return `inlineTemplate:{render:function(){${
      inlineRenderFns.render
    }},staticRenderFns:[${inlineRenderFns.staticRenderFns
      .map((code) => `function(){${code}}`)
      .join(",")}]}`;
  }
}

function genScopedSlots(
  el: ASTElement,
  slots: { [key: string]: ASTElement },
  state: CodegenState
): string {
  // by default scoped slots are considered "stable", this allows child
  // components with only scoped slots to skip forced updates from parent.
  // but in some cases we have to bail-out of this optimization
  // for example if the slot contains dynamic names, has v-if or v-for on them...
  let needsForceUpdate =
    el.for ||
    Object.keys(slots).some((key) => {
      const slot = slots[key];
      return (
        slot.slotTargetDynamic || slot.if || slot.for || containsSlotChild(slot) // is passing down slot from parent which may be dynamic
      );
    });

  // #9534: if a component with scoped slots is inside a conditional branch,
  // it's possible for the same component to be reused but with different
  // compiled slot content. To avoid that, we generate a unique key based on
  // the generated code of all the slot contents.
  let needsKey = !!el.if;

  // OR when it is inside another scoped slot or v-for (the reactivity may be
  // disconnected due to the intermediate scope variable)
  // #9438, #9506
  // TODO: this can be further optimized by properly analyzing in-scope bindings
  // and skip force updating ones that do not actually use scope variables.
  if (!needsForceUpdate) {
    let parent = el.parent;
    while (parent) {
      if (
        (parent.slotScope && parent.slotScope !== emptySlotScopeToken) ||
        parent.for
      ) {
        needsForceUpdate = true;
        break;
      }
      if (parent.if) {
        needsKey = true;
      }
      parent = parent.parent;
    }
  }

  const generatedSlots = Object.keys(slots)
    .map((key) => genScopedSlot(slots[key], state))
    .join(",");

  return `scopedSlots:_u([${generatedSlots}]${
    needsForceUpdate ? `,null,true` : ``
  }${
    !needsForceUpdate && needsKey ? `,null,false,${hash(generatedSlots)}` : ``
  })`;
}

function hash(str) {
  let hash = 5381;
  let i = str.length;
  while (i) {
    hash = (hash * 33) ^ str.charCodeAt(--i);
  }
  return hash >>> 0;
}

function containsSlotChild(el: ASTNode): boolean {
  if (el.type === 1) {
    if (el.tag === "slot") {
      return true;
    }
    return el.children.some(containsSlotChild);
  }
  return false;
}

function genScopedSlot(el: ASTElement, state: CodegenState): string {
  const isLegacySyntax = el.attrsMap["slot-scope"];
  if (el.if && !el.ifProcessed && !isLegacySyntax) {
    return genIf(el, state, genScopedSlot, `null`);
  }
  if (el.for && !el.forProcessed) {
    return genFor(el, state, genScopedSlot);
  }
  const slotScope =
    el.slotScope === emptySlotScopeToken ? `` : String(el.slotScope);
  const fn =
    `function(${slotScope}){` +
    `return ${
      el.tag === "template"
        ? el.if && isLegacySyntax
          ? `(${el.if})?${genChildren(el, state) || "undefined"}:undefined`
          : genChildren(el, state) || "undefined"
        : genElement(el, state)
    }}`;
  // reverse proxy v-slot without scope on this.$slots
  const reverseProxy = slotScope ? `` : `,proxy:true`;
  return `{key:${el.slotTarget || `"default"`},fn:${fn}${reverseProxy}}`;
}

/**
 * 生成当前节点的所有子节点的渲染函数，返回一个数组，格式如：
 * [_c(tag, data, children), ...],normalizationType
 * @param {*} el dom
 * @param {*} state 状态
 * @param {*} checkSkip 布尔值
 * @param {*} altGenElement
 * @param {*} altGenNode
 * @returns
 */
export function genChildren(
  el: ASTElement,
  state: CodegenState,
  checkSkip?: boolean,
  altGenElement?: Function,
  altGenNode?: Function
): string | void {
  /**所有子节点 */
  const children = el.children;

  if (children.length) {
    /**第一个子节点 */
    const el: any = children[0];
    // optimize single v-for 优化单 v-for
    if (
      children.length === 1 /**如果只有一个子节点 */ &&
      el.for &&
      el.tag !== "template" /**节点不是template */ &&
      el.tag !== "slot" /**节点不是slot */
    ) {
      /**
       * 得到节点规范化类型， 结果为0 or 1 or 2
       *
       * 优化，只有一个子节点 && 子节点的上有 v-for 指令 && 子节点的标签不为 template 或者 slot
       * 优化的方式是直接调用 genElement 生成该节点的渲染函数，不需要走下面的循环然后调用 genCode 最后得到渲染函数
       */
      const normalizationType = checkSkip
        ? state.maybeComponent(el)
          ? `,1`
          : `,0`
        : ``;

      return `${(altGenElement || genElement)(el, state)}${normalizationType}`;
    }

    /**
     * 获取节点规范化类型，返回一个 number 0、1、2，不是重点， 不重要
     * 0:不需要标准化
     * 1:需要简单的标准化(可能是1级深嵌套数组)
     * 2:需要完全标准化
     */
    const normalizationType = checkSkip
      ? getNormalizationType(
          children /**子节点 */,
          state.maybeComponent /**判断是否是组件 */
        ) /**如果children.length==0 就返回0，如果如果有for属性存在或者tag等于template或者是slot 则问真就返回1，如果是组件则返回2 */
      : 0;
    /**
     * 函数，生成代码的一个函数
     * genNode根据node.type 属性不同调用不同的方法,得到不同的虚拟dom渲染方法
     */
    const gen = altGenNode || genNode;

    /**
     * 返回一个数组，数组的每个元素都是一个子节点的渲染函数，
     * 格式：['_c(tag, data, children)', ...], normalizationType
     */
    return `[${children.map((c) => gen(c, state)).join(",")}]${
      normalizationType ? `,${normalizationType}` : ""
    }`;
  }
}

// determine the normalization needed for the children array.
// 0: no normalization needed
// 1: simple normalization needed (possible 1-level deep nested array)
// 2: full normalization needed

/**
 * 确定子数组所需的标准化。
 * 0:不需要标准化
 * 1:需要简单的标准化(可能是1级深嵌套数组)
 * 2:需要完全标准化
 * 如果children.length==0 就返回0，如果如果有for属性存在或者tag等于template或者是slot 则问真就返回1，如果是组件则返回2
 * @param {*} children
 * @param {*} maybeComponent
 * @returns
 */
function getNormalizationType(
  children: Array<ASTNode>,
  maybeComponent: (el: ASTElement) => boolean
): number {
  let res = 0;
  /**循环子节点 */
  for (let i = 0; i < children.length; i++) {
    const el: ASTNode = children[i];
    if (el.type !== 1) {
      /**如果是真是dom则跳过循环 */
      continue;
    }
    /**如果有for属性存在或者tag等于template或者是slot 则问为真 */
    if (
      needsNormalization(el) ||
      (el.ifConditions &&
        el.ifConditions.some((c) =>
          /**判断数组中是否存在满足条件的项，只要有一项满足条件，就会返回true。 */ needsNormalization(
            c.block
          )
        ))
    ) {
      res = 2;
      break;
    }
    if (
      maybeComponent(el) /**判断是否是组件 */ ||
      (el.ifConditions &&
        el.ifConditions.some((c) =>
          maybeComponent(c.block)
        )) /**判断数组中是否存在满足条件的项，只要有一项满足条件，就会返回true。 */
    ) {
      res = 1;
    }
  }
  return res;
}

/**
 * 如果for属性存在或者tag等于template或者是slot 则为真
 * @param {*} el
 * @returns
 */
function needsNormalization(el: ASTElement): boolean {
  return el.for !== undefined || el.tag === "template" || el.tag === "slot";
}

/**
 * 根据node.type 属性不同调用不同的方法
 * @param {*} node
 * @param {*} state
 * @returns
 */
function genNode(node: ASTNode, state: CodegenState): string {
  if (node.type === 1) {
    /**生成节点 */
    return genElement(node, state);
  } else if (node.type === 3 && node.isComment) {
    /**注释 */
    return genComment(node);
  } else {
    /**文本 */
    return genText(node);
  }
}

/**
 * 返回虚拟dom vonde渲染调用的函数
 * @param {*} text
 * @returns
 */
export function genText(text: ASTText | ASTExpression): string {
  return `_v(${
    text.type === 2
      ? text.expression // no need for () because already wrapped in _s()
      : transformSpecialNewlines(JSON.stringify(text.text))
  })`;
}

/**
 * 返回虚拟dom vonde渲染调用的函数
 * @param {*} comment
 * @returns
 */
export function genComment(comment: ASTText): string {
  return `_e(${JSON.stringify(comment.text)})`;
}

/**
 * 生成插槽的渲染函数，得到
 * _t(slotName, children, attrs, bind)
 * @param {*} el
 * @param {*} state
 * @returns
 */
function genSlot(el: ASTElement, state: CodegenState): string {
  /**插槽名称 */
  const slotName = el.slotName || '"default"';
  /**生成所有的子节点 */
  const children = genChildren(el, state);
  /**结果字符串，_t(slotName, children, attrs, bind) */
  let res = `_t(${slotName}${
    children ? `,function(){return ${children}}` : ""
  }`;
  const attrs =
    el.attrs || el.dynamicAttrs
      ? genProps(
          (el.attrs || []).concat(el.dynamicAttrs || []).map((attr) => ({
            // slot props are camelized
            name: camelize(attr.name),
            value: attr.value,
            dynamic: attr.dynamic,
          }))
        )
      : null;
  const bind = el.attrsMap["v-bind"];
  if ((attrs || bind) && !children) {
    res += `,null`;
  }
  if (attrs) {
    res += `,${attrs}`;
  }
  if (bind) {
    res += `${attrs ? "" : ",null"},${bind}`;
  }
  return res + ")";
}

/**
 * componentName is el.component, take it as argument to shun flow's pessimistic refinement
 * 生成动态组件的渲染函数
 * 返回 `_c(compName, data, children)`
 * @param {*} componentName
 * @param {*} el
 * @param {*} state
 * @returns
 */
function genComponent(
  componentName: string,
  el: ASTElement,
  state: CodegenState
): string {
  /**生成所有的子节点的渲染函数 */
  const children = el.inlineTemplate ? null : genChildren(el, state, true);
  /**
   * 返回 `_c(compName, data, children)`
   * compName 是 is 属性的值
   */
  return `_c(${componentName},${genData(el, state)}${
    children ? `,${children}` : ""
  })`;
}

/**
 * 遍历属性数组 props，得到所有属性组成的字符串
 * 如果不存在动态属性，则返回：  'attrName,attrVal,...'
 * 如果存在动态属性，则返回： '_d(静态属性字符串, 动态属性字符串)'
 * @param {*} props
 * @returns
 */
function genProps(props: Array<ASTAttr>): string {
  /**静态属性 */
  let staticProps = ``;

  /**动态属性 */
  let dynamicProps = ``;

  /** 遍历属性数组 */
  for (let i = 0; i < props.length; i++) {
    /**属性 */
    const prop = props[i];

    /**属性值 */
    const value = __WEEX__
      ? generateValue(prop.value)
      : transformSpecialNewlines(prop.value);

    if (prop.dynamic) {
      /**动态属性，`dAttrName,dAttrVal,...` */
      dynamicProps += `${prop.name},${value},`;
    } else {
      /**静态属性，'"attrName":attrVal,...' */
      staticProps += `"${prop.name}":${value},`;
    }
  }

  /**去掉静态属性最后的逗号 */
  staticProps = `{${staticProps.slice(0, -1)}}`;
  if (dynamicProps) {
    /**
     * 如果存在动态属性则返回： _d(staticProps, [dAttrName,dAttrVal,...])
     */
    return `_d(${staticProps},[${dynamicProps.slice(0, -1)}])`;
  } else {
    /**
     * 说明属性数组中不存在动态属性，直接返回静态属性字符串'"attrName":attrVal,...'
     */
    return staticProps;
  }
}

/* istanbul ignore next */
function generateValue(value) {
  if (typeof value === "string") {
    return transformSpecialNewlines(value);
  }
  return JSON.stringify(value);
}

// #3895, #4268
/**
 * \u2028	 	行分隔符	行结束符
 * \u2029	 	段落分隔符	行结束符
 *  这个编码为2028的字符为行分隔符，会被浏览器理解为换行，而在Javascript的字符串表达式中是不允许换行的，从而导致错误。
 *  把特殊字符转义替换即可，代码如下所示：str = str.Replace("\u2028", "\\u2028");
 * @param {*} text
 * @returns
 */
function transformSpecialNewlines(text: string): string {
  return text.replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}
