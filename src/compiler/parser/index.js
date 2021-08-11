/* @flow */

import he from "he";
import { parseHTML } from "./html-parser";
import { parseText } from "./text-parser";
import { parseFilters } from "./filter-parser";
import { genAssignmentCode } from "../directives/model";
import { extend, cached, no, camelize, hyphenate } from "shared/util";
import { isIE, isEdge, isServerRendering } from "core/util/env";

import {
  addProp,
  addAttr,
  baseWarn,
  addHandler,
  addDirective,
  getBindingAttr,
  getAndRemoveAttr,
  getRawBindingAttr,
  pluckModuleFunction,
  getAndRemoveAttrByRegex,
} from "../helpers";

export const onRE = /^@|^v-on:/;
export const dirRE = process.env.VBIND_PROP_SHORTHAND
  ? /^v-|^@|^:|^\.|^#/
  : /^v-|^@|^:|^#/;
export const forAliasRE = /([\s\S]*?)\s+(?:in|of)\s+([\s\S]*)/;
export const forIteratorRE = /,([^,\}\]]*)(?:,([^,\}\]]*))?$/;
const stripParensRE = /^\(|\)$/g;
const dynamicArgRE = /^\[.*\]$/;

const argRE = /:(.*)$/;
export const bindRE = /^:|^\.|^v-bind:/;
const propBindRE = /^\./;
const modifierRE = /\.[^.\]]+(?=[^\]]*$)/g;

const slotRE = /^v-slot(:|$)|^#/;

const lineBreakRE = /[\r\n]/;
const whitespaceRE = /[ \f\t\r\n]+/g;

const invalidAttributeRE = /[\s"'<>\/=]/;

const decodeHTMLCached = cached(he.decode);

export const emptySlotScopeToken = `_empty_`;

// configurable state
export let warn: any;
let delimiters;
let transforms;
let preTransforms;
let postTransforms;
let platformIsPreTag;
let platformMustUseProp;
let platformGetTagNamespace;
let maybeComponent;

/**
 * 为指定元素创建 AST 对象
 * @param {*} tag  tag 标签名
 * @param {*} attrs  attrs 属性数组，[{ name: attrName, value: attrVal, start, end }, ...]
 * @param {*} parent  父元素
 * @returns  { type: 1, tag, attrsList, attrsMap: makeAttrsMap(attrs), rawAttrsMap: {}, parent, children: []}
 */
export function createASTElement(
  tag: string,
  attrs: Array<ASTAttr>,
  parent: ASTElement | void
): ASTElement {
  return {
    /**节点类型 */
    type: 1,
    /**标签名 */
    tag,
    /**属性数组 */
    attrsList: attrs,
    /**将属性数组变成对象 {attrName: attrValue} */
    attrsMap: makeAttrsMap(attrs),
    /**定义一个空对象为原始属性对象，最后的结果和attrsMap一样 */
    rawAttrsMap: {},
    /**标记当前父元素 */
    parent,
    /**存放所有子元素 */
    children: [],
  };
}

/**
 * Convert HTML string to AST.
 * 将html字符串转换为ast
 * @param {*} template
 * @param {*} options
 * @returns
 */
export function parse(
  template: string,
  options: CompilerOptions
): ASTElement | void {
  /**日志 */
  warn = options.warn || baseWarn;
  /**平台的pre标签 */
  platformIsPreTag = options.isPreTag || no;
  /**必须使用prop进行绑定的属性 */
  platformMustUseProp = options.mustUseProp || no;
  /**获取标签的命名空间 */
  platformGetTagNamespace = options.getTagNamespace || no;
  /**是否是保留标签（html + svg） */
  const isReservedTag = options.isReservedTag || no;
  /**是否是一个组件 */
  maybeComponent = (el: ASTElement) =>
    !!(
      el.component ||
      el.attrsMap[":is"] ||
      el.attrsMap["v-bind:is"] ||
      !(el.attrsMap.is ? isReservedTag(el.attrsMap.is) : isReservedTag(el.tag))
    );

  /**
   * 三个数组,数组中每个元素都是一个函数
   * 这些函数分别是style、class、model这三个模块中导出的对应函数
   * 分别获取options。modules下的class、model、style 三个模块中的transformNode、preTransformNode、postTransformNode方法
   * 负责处理元素节点上的class、style、v-model
   * platform/web/compiler/modules/class
   * platform/web/compiler/modules/style
   * platform/web/compiler/modules/model
   */
  transforms = pluckModuleFunction(options.modules, "transformNode");
  preTransforms = pluckModuleFunction(options.modules, "preTransformNode");
  postTransforms = pluckModuleFunction(options.modules, "postTransformNode");

  /**界定符,比如{{}}*/
  delimiters = options.delimiters;

  /**解析的中间结果都放在这里 */
  const stack = [];
  /**是否保留空白元素 */
  const preserveWhitespace = options.preserveWhitespace !== false;
  /**空白元素的选项 */
  const whitespaceOption = options.whitespace;
  /**最终return出去的ast对象 */
  let root;
  /**记录当前元素的父元素 */
  let currentParent;

  let inVPre = false;
  let inPre = false;
  let warned = false;

  function warnOnce(msg, range) {
    if (!warned) {
      warned = true;
      warn(msg, range);
    }
  }

  function closeElement(element) {
    trimEndingWhitespace(element);
    if (!inVPre && !element.processed) {
      element = processElement(element, options);
    }
    // tree management
    if (!stack.length && element !== root) {
      // allow root elements with v-if, v-else-if and v-else
      if (root.if && (element.elseif || element.else)) {
        if (process.env.NODE_ENV !== "production") {
          checkRootConstraints(element);
        }
        addIfCondition(root, {
          exp: element.elseif,
          block: element,
        });
      } else if (process.env.NODE_ENV !== "production") {
        warnOnce(
          `Component template should contain exactly one root element. ` +
            `If you are using v-if on multiple elements, ` +
            `use v-else-if to chain them instead.`,
          { start: element.start }
        );
      }
    }
    if (currentParent && !element.forbidden) {
      if (element.elseif || element.else) {
        processIfConditions(element, currentParent);
      } else {
        if (element.slotScope) {
          // scoped slot
          // keep it in the children list so that v-else(-if) conditions can
          // find it as the prev node.
          const name = element.slotTarget || '"default"';
          (currentParent.scopedSlots || (currentParent.scopedSlots = {}))[
            name
          ] = element;
        }
        currentParent.children.push(element);
        element.parent = currentParent;
      }
    }

    // final children cleanup
    // filter out scoped slots
    element.children = element.children.filter((c) => !(c: any).slotScope);
    // remove trailing whitespace node again
    trimEndingWhitespace(element);

    // check pre state
    if (element.pre) {
      inVPre = false;
    }
    if (platformIsPreTag(element.tag)) {
      inPre = false;
    }
    // apply post-transforms
    for (let i = 0; i < postTransforms.length; i++) {
      postTransforms[i](element, options);
    }
  }

  function trimEndingWhitespace(el) {
    // remove trailing whitespace node
    if (!inPre) {
      let lastNode;
      while (
        (lastNode = el.children[el.children.length - 1]) &&
        lastNode.type === 3 &&
        lastNode.text === " "
      ) {
        el.children.pop();
      }
    }
  }

  function checkRootConstraints(el) {
    if (el.tag === "slot" || el.tag === "template") {
      warnOnce(
        `Cannot use <${el.tag}> as component root element because it may ` +
          "contain multiple nodes.",
        { start: el.start }
      );
    }
    if (el.attrsMap.hasOwnProperty("v-for")) {
      warnOnce(
        "Cannot use v-for on stateful component root element because " +
          "it renders multiple elements.",
        el.rawAttrsMap["v-for"]
      );
    }
  }

  /**
   * 解析html模板字符串，处理所有标签以及标签上的属性
   */
  parseHTML(template, {
    warn,
    expectHTML: options.expectHTML,
    isUnaryTag: options.isUnaryTag,
    canBeLeftOpenTag: options.canBeLeftOpenTag,
    shouldDecodeNewlines: options.shouldDecodeNewlines,
    shouldDecodeNewlinesForHref: options.shouldDecodeNewlinesForHref,
    shouldKeepComment: options.comments,
    outputSourceRange: options.outputSourceRange,
    /**
     * 处理开始标签
     * 主要做了以下 6 件事情:
     *   1、创建 AST 对象
     *   2、处理存在 v-model 指令的 input 标签，分别处理 input 为 checkbox、radio、其它的情况
     *   3、处理标签上的众多指令，比如 v-pre、v-for、v-if、v-once
     *   4、如果根节点 root 不存在则设置当前元素为根节点
     *   5、如果当前元素为非自闭合标签则将自己 push 到 stack 数组，并记录 currentParent，在接下来处理子元素时用来告诉子元素自己的父节点是谁
     *   6、如果当前元素为自闭合标签，则表示该标签要处理结束了，让自己和父元素产生关系，以及设置自己的子元素
     * @param {*} tag 标签名
     * @param {*} attrs 属性数组 [{name: attrName, value: attrValue, start, end},...]
     * @param {*} unary 是否为自闭合标签
     * @param {*} start 标签的开始索引位置
     * @param {*} end 结束索引位置
     */
    start(tag, attrs, unary, start, end) {
      // check namespace.
      // inherit parent ns if there is one
      /**
       * 检查命名空间，如果存在，则继承父命名空间
       **/
      const ns =
        (currentParent && currentParent.ns) || platformGetTagNamespace(tag);

      // handle IE svg bug
      /* istanbul ignore if */
      /**IE处理 */
      if (isIE && ns === "svg") {
        attrs = guardIESVGBug(attrs);
      }

      /**生成当前标签的ast对象 */
      let element: ASTElement = createASTElement(tag, attrs, currentParent);
      if (ns) {
        /**添加命名空间 */
        element.ns = ns;
      }

      if (process.env.NODE_ENV !== "production") {
        /**这段在非生产环境下会走，在 ast 对象上添加 一些 属性，比如 start、end */
        if (options.outputSourceRange) {
          /**添加索引 */
          element.start = start;
          element.end = end;
          /**处理rawAttrsMap，将属性数组解析成 { attrName: { name: attrName, value: attrVal, start, end }, ... } 形式的对象*/
          element.rawAttrsMap = element.attrsList.reduce((cumulated, attr) => {
            cumulated[attr.name] = attr;
            return cumulated;
          }, {});
        }
        attrs.forEach((attr) => {
          if (invalidAttributeRE.test(attr.name)) {
            /**
             * 对属性名做有效性校验
             * 验证属性是否有效，比如属性名不能包含: spaces, quotes, <, >, / or =.
             **/
            warn(
              `Invalid dynamic argument expression: attribute names cannot contain ` +
                `spaces, quotes, <, >, / or =.`,
              {
                start: attr.start + attr.name.indexOf(`[`),
                end: attr.start + attr.name.length,
              }
            );
          }
        });
      }
      /**
       * 非服务端渲染的情况下，模版中不应该出现 style、script 标签
       */
      if (isForbiddenTag(element) && !isServerRendering()) {
        element.forbidden = true;
        process.env.NODE_ENV !== "production" &&
          warn(
            "Templates should only be responsible for mapping the state to the " +
              "UI. Avoid placing tags with side-effects in your templates, such as " +
              `<${tag}>` +
              ", as they will not be parsed.",
            { start: element.start }
          );
      }

      // apply pre-transforms
      /**
       * 为 element 对象分别执行 class、style、model 模块中的 preTransforms 方法
       * 不过 web 平台只有 model 模块有 preTransforms 方法 /src/platforms/web/compiler/modules/model
       * 用来处理存在 v-model 的 input 标签，但没处理 v-model 属性
       * 分别处理了 input 为 checkbox、radio 和 其它的情况
       * input 具体是哪种情况由 el.ifConditions 中的条件来判断
       * <input v-mode="test" :type="checkbox or radio or other(比如 text)" />
       */
      for (let i = 0; i < preTransforms.length; i++) {
        element = preTransforms[i](element, options) || element;
      }

      if (!inVPre) {
        /**表示 element 是否存在 v-pre 指令，存在则设置 element.pre = true */
        processPre(element);
        if (element.pre) {
          /**存在 v-pre 指令，则设置 inVPre 为 true */
          inVPre = true;
        }
      }
      /**如果 pre 标签，则设置 inPre 为 true */
      if (platformIsPreTag(element.tag)) {
        inPre = true;
      }
      if (inVPre) {
        /**
         * 说明标签上存在 v-pre 指令，这样的节点只会渲染一次，将节点上的属性都设置到 el.attrs 数组对象中，作为静态属性，数据更新时不会渲染这部分内容
         * 设置 el.attrs 数组对象，每个元素都是一个属性对象 { name: attrName, value: attrVal, start, end }处。
         */
        processRawAttrs(element);
      } else if (!element.processed) {
        // structural directives

        /**
         * 处理 v-for 属性，得到 element.for = 可迭代对象 element.alias = 别名
         */
        processFor(element);
        /**
         * 处理 v-if、v-else-if、v-else
         * 得到 element.if = "exp"，element.elseif = exp, element.else = true
         * v-if 属性会额外在 element.ifConditions 数组中添加 { exp, block } 对象
         */
        processIf(element);
        /**
         * 处理 v-once 指令，得到 element.once = true
         **/
        processOnce(element);
      }
      /**如果 root 不存在，则表示当前处理的元素为第一个元素，即组件的 根 元素 */
      if (!root) {
        root = element;
        /**检查根元素，对根元素有一些限制，比如：不能使用 slot 和 template 作为根元素，也不能在有状态组件的根元素上使用 v-for 指令 */
        if (process.env.NODE_ENV !== "production") {
          checkRootConstraints(root);
        }
      }

      if (!unary) {
        /**非自闭合标签，通过 currentParent 记录当前元素，下一个元素在处理的时候，就知道自己的父元素是谁 */
        currentParent = element;
        /**
         * 然后将 element push 到 stack 数组，将来处理到当前元素的闭合标签时再拿出来
         * 将当前标签的 ast 对象 push 到 stack 数组中，这里需要注意，在调用 options.start 方法
         * 之前也发生过一次 push 操作，那个 push 进来的是当前标签的一个基本配置信息
         */
        stack.push(element);
      } else {
        /**
         * 说明当前元素为自闭合标签，主要做了 3 件事：
         *  1、如果元素没有被处理过，即 el.processed 为 false，则调用 processElement 方法处理节点上的众多属性
         *  2、让自己和父元素产生关系，将自己放到父元素的 children 数组中，并设置自己的 parent 属性为 currentParent
         *  3、设置自己的子元素，将自己所有非插槽的子元素放到自己的 children 数组中
         */
        closeElement(element);
      }
    },
    /**
     * 处理结束标签
     * @param {*} tag tag 结束标签的名称
     * @param {*} start 结束标签的开始索引
     * @param {*} end 结束标签的结束索引
     */
    end(tag, start, end) {
      /**
       * 结束标签对应的开始标签的ast对象
       */
      const element = stack[stack.length - 1];
      // pop stack
      stack.length -= 1;
      /**这块儿有点不太理解，因为上一个元素有可能是当前元素的兄弟节点 */
      currentParent = stack[stack.length - 1];
      if (process.env.NODE_ENV !== "production" && options.outputSourceRange) {
        element.end = end;
      }
      /**
       * 主要做了 3 件事：
       *   1、如果元素没有被处理过，即 el.processed 为 false，则调用 processElement 方法处理节点上的众多属性
       *   2、让自己和父元素产生关系，将自己放到父元素的 children 数组中，并设置自己的 parent 属性为 currentParent
       *   3、设置自己的子元素，将自己所有非插槽的子元素放到自己的 children 数组中
       */
      closeElement(element);
    },

    /**
     * 处理文本，基于文本生成 ast 对象，然后将该 ast 放到它的父元素里，即 currentParent.children 数组中
     * @param {*} text
     * @param {*} start
     * @param {*} end
     * @returns
     */
    chars(text: string, start: number, end: number) {
      /**
       * 异常处理
       * currentParent不存在， 说明这段文本没有父元素
       */
      if (!currentParent) {
        if (process.env.NODE_ENV !== "production") {
          if (text === template) {
            /**文本不能作为组件的根元素 */
            warnOnce(
              "Component template requires a root element, rather than just text.",
              { start }
            );
          } else if ((text = text.trim())) {
            /**放在根元素之外的文本会被忽略 */
            warnOnce(`text "${text}" outside root element will be ignored.`, {
              start,
            });
          }
        }
        return;
      }
      // IE textarea placeholder bug
      /* istanbul ignore if */
      if (
        isIE &&
        currentParent.tag === "textarea" &&
        currentParent.attrsMap.placeholder === text
      ) {
        return;
      }

      /**获取当前父元素的所有孩子节点 */
      const children = currentParent.children;
      /**对 text 进行一系列的处理，比如删除空白字符，或者存在 whitespaceOptions 选项，则 text 直接置为空或者空格 */
      if (inPre || text.trim()) {
        /**文本在 pre 标签内 或者 text.trim() 不为空 */
        text = isTextTag(currentParent) ? text : decodeHTMLCached(text);
      } else if (!children.length) {
        /**
         * remove the whitespace-only node right after an opening tag
         * 说明文本不在 pre 标签内而且 text.trim() 为空，而且当前父元素也没有孩子节点，则将 text 置为空
         */
        text = "";
      } else if (whitespaceOption) {
        /**压缩处理 */
        if (whitespaceOption === "condense") {
          // in condense mode, remove the whitespace node if it contains
          // line break, otherwise condense to a single space
          text = lineBreakRE.test(text) ? "" : " ";
        } else {
          text = " ";
        }
      } else {
        text = preserveWhitespace ? " " : "";
      }
      /**如果经过处理后 text 还存在 */
      if (text) {
        if (!inPre && whitespaceOption === "condense") {
          /**
           * condense consecutive whitespaces into single space
           * 不在 pre 节点中，并且配置选项中存在压缩选项，则将多个连续空格压缩为单个
           */
          text = text.replace(whitespaceRE, " ");
        }
        let res;
        let child: ?ASTNode;
        /**基于 text 生成 AST 对象 */
        if (!inVPre && text !== " " && (res = parseText(text, delimiters))) {
          /**文本中存在表达式（即有界定符） */
          child = {
            type: 2,
            /**表达式 */
            expression: res.expression,
            tokens: res.tokens,
            /**文本 */
            text,
          };
        } else if (
          text !== " " ||
          !children.length ||
          children[children.length - 1].text !== " "
        ) {
          /**纯文本节点 */
          child = {
            type: 3,
            text,
          };
        }
        /**child 存在，则将 child 放到父元素的肚子里，即 currentParent.children 数组中 */
        if (child) {
          if (
            process.env.NODE_ENV !== "production" &&
            options.outputSourceRange
          ) {
            child.start = start;
            child.end = end;
          }
          children.push(child);
        }
      }
    },
    /**
     * 处理注释内容
     * @param {*} text 注释内容
     * @param {*} start 开始索引
     * @param {*} end 结束索引
     */
    comment(text: string, start, end) {
      // adding anything as a sibling to the root node is forbidden
      // comments should still be allowed, but ignored
      /**
       * 不存在currentParent
       * 表示一开始就存在注释， 直接忽略
       *
       * 禁止将任何内容作为 root 的节点的同级进行添加，注释应该被允许，但是会被忽略
       * 如果 currentParent 不存在，说明注释和 root 为同级，忽略
       */
      if (currentParent) {
        const child: ASTText = {
          /**节点类型 */
          type: 3,
          /**注释内容 */
          text,
          /**是否为注释 */
          isComment: true,
        };
        if (
          process.env.NODE_ENV !== "production" &&
          options.outputSourceRange
        ) {
          /**记录节点的开始索引和结束索引 */
          child.start = start;
          child.end = end;
        }
        /**将注释内容放置父元素，将当前注释节点放到父元素的 children 属性中 */
        currentParent.children.push(child);
      }
    },
  });
  /**返回生成的ast对象 */
  return root;
}

function processPre(el) {
  if (getAndRemoveAttr(el, "v-pre") != null) {
    el.pre = true;
  }
}

function processRawAttrs(el) {
  const list = el.attrsList;
  const len = list.length;
  if (len) {
    const attrs: Array<ASTAttr> = (el.attrs = new Array(len));
    for (let i = 0; i < len; i++) {
      attrs[i] = {
        name: list[i].name,
        value: JSON.stringify(list[i].value),
      };
      if (list[i].start != null) {
        attrs[i].start = list[i].start;
        attrs[i].end = list[i].end;
      }
    }
  } else if (!el.pre) {
    // non root node in pre blocks with no attributes
    el.plain = true;
  }
}
/**
 * 分别处理元素节点的key、ref、插槽、自闭合的slot标签、动态组件、class、style、v-bind、v-on、其他指令和一些元素属性
 * 然后再el对象上添加如下属性
 *
 * el.key、ref、refInFor、scopedSlot、slotName、component、inlineTemplate、staticClass
 * el.bindingClass、staticStyle、bindingStyle、attrs
 *
 * @param {*} element 被处理元素的ast元素
 * @param {*} options options 配置项
 * @returns
 */
export function processElement(element: ASTElement, options: CompilerOptions) {
  /**el.key = val */
  processKey(element);

  /**
   * 确定element是否为一个普通元素
   * determine whether this is a plain element after
   * removing structural attributes
   */
  element.plain =
    !element.key && !element.scopedSlots && !element.attrsList.length;

  /**el.ref = val, el.refInFor = boolean */
  processRef(element);

  /**
   * 处理作为插槽传递给组件的内容
   * 得到插槽名称、是否为动态插槽、作用域插槽的值以及插槽中的所有子元素
   * 子元素放到插槽对象的children属性中
   */
  processSlotContent(element);

  /**
   * 处理自闭合的slot标签， 得到插槽名称 => el.slotName = xx
   */
  processSlotOutlet(element);

  /**
   * 处理动态组件，<component :is="componentName" /> 得到 el.component = componentName
   * 以及标记是否存在内联模板，el.inlineTemplate = true or false
   */
  processComponent(element);

  /**
   * 为 element 对象分别执行 class、style、model 模块中的 transformNode 方法
   * 不过 web 平台只有 class、style 模块有 transformNode 方法，分别用来处理 class 属性和 style 属性
   * 得到 el.staticStyle、 el.styleBinding、el.staticClass、el.classBinding
   */
  for (let i = 0; i < transforms.length; i++) {
    element = transforms[i](element, options) || element;
  }

  /**
   * 处理元素上的所有属性：
   * v-bind 指令变成：el.attrs 或 el.dynamicAttrs = [{ name, value, start, end, dynamic }, ...]，
   *                或者是必须使用 props 的属性，变成了 el.props = [{ name, value, start, end, dynamic }, ...]
   * v-on 指令变成：el.events 或 el.nativeEvents = { name: [{ value, start, end, modifiers, dynamic }, ...] }
   * 其它指令：el.directives = [{name, rawName, value, arg, isDynamicArg, modifier, start, end }, ...]
   * 原生属性：el.attrs = [{ name, value, start, end }]，或者一些必须使用 props 的属性，变成了：
   *         el.props = [{ name, value: true, start, end, dynamic }]
   */
  processAttrs(element);
  return element;
}

/**
 * 处理元素上的key属性， 设置el.key = val
 * @param {*} el
 */
function processKey(el) {
  /**获取key的属性值 */
  const exp = getBindingAttr(el, "key");
  if (exp) {
    /**关于key使用上的异常处理 */
    if (process.env.NODE_ENV !== "production") {
      if (el.tag === "template") {
        /**template 标签不允许设置 key */
        warn(
          `<template> cannot be keyed. Place the key on real elements instead.`,
          getRawBindingAttr(el, "key")
        );
      }
      /**不要在<transition-group></transition-group>的子元素使用v-for的index作为key，这和没有key没什么区别 */
      if (el.for) {
        const iterator = el.iterator2 || el.iterator1;
        const parent = el.parent;
        if (
          iterator &&
          iterator === exp &&
          parent &&
          parent.tag === "transition-group"
        ) {
          warn(
            `Do not use v-for index as key on <transition-group> children, ` +
              `this is the same as not using keys.`,
            getRawBindingAttr(el, "key"),
            true /* tip */
          );
        }
      }
    }
    /**设置el.key = exp */
    el.key = exp;
  }
}

/**
 * 处理元素上的ref属性
 * el.ref = refVal
 * el.refInFor = boolean
 * @param {*} el
 */
function processRef(el) {
  const ref = getBindingAttr(el, "ref");
  if (ref) {
    el.ref = ref;
    /**
     * 判断包含ref属性的元素是否包含具有v-for指令的元素内或后代元素中
     * 如果是，则ref指向的则是包含DOM节点或组件实例的数组
     */
    el.refInFor = checkInFor(el);
  }
}
/**
 * 处理 v-for， 将结果设置到el对象上，得到
 * el.for = 可迭代对象， 比如 arr
 * el.alias = 别名， 比如 item
 * @param {*} el 元素的ast对象
 */
export function processFor(el: ASTElement) {
  let exp;
  /**获取el上的v-for属性值 */
  if ((exp = getAndRemoveAttr(el, "v-for"))) {
    /**
     * 解析v-for的表达式
     * 得到{ for: 可迭代对象， alias: 别名 }
     * 比如{ for: arr, alias: item }
     */
    const res = parseFor(exp);
    if (res) {
      /**
       * 将res对象上的属性拷贝到el对象上
       */
      extend(el, res);
    } else if (process.env.NODE_ENV !== "production") {
      warn(`Invalid v-for expression: ${exp}`, el.rawAttrsMap["v-for"]);
    }
  }
}

type ForParseResult = {
  for: string,
  alias: string,
  iterator1?: string,
  iterator2?: string,
};

/**
 * 解析 v-for指令的表达式
 * @param {*} exp
 * @returns { for: iterator, alias: string  } { for: 迭代器，比如数组, alias: 别名，比如item }
 */
export function parseFor(exp: string): ?ForParseResult {
  /**正则匹配回去表达式 in | of */
  const inMatch = exp.match(forAliasRE);

  if (!inMatch) return;
  const res = {};
  /**for = "迭代对象" */
  res.for = inMatch[2].trim();

  /**别名 */
  const alias = inMatch[1].trim().replace(stripParensRE, "");
  const iteratorMatch = alias.match(forIteratorRE);
  if (iteratorMatch) {
    res.alias = alias.replace(forIteratorRE, "").trim();
    res.iterator1 = iteratorMatch[1].trim();
    if (iteratorMatch[2]) {
      res.iterator2 = iteratorMatch[2].trim();
    }
  } else {
    res.alias = alias;
  }
  return res;
}

function processIf(el) {
  const exp = getAndRemoveAttr(el, "v-if");
  if (exp) {
    el.if = exp;
    addIfCondition(el, {
      exp: exp,
      block: el,
    });
  } else {
    if (getAndRemoveAttr(el, "v-else") != null) {
      el.else = true;
    }
    const elseif = getAndRemoveAttr(el, "v-else-if");
    if (elseif) {
      el.elseif = elseif;
    }
  }
}

function processIfConditions(el, parent) {
  const prev = findPrevElement(parent.children);
  if (prev && prev.if) {
    addIfCondition(prev, {
      exp: el.elseif,
      block: el,
    });
  } else if (process.env.NODE_ENV !== "production") {
    warn(
      `v-${el.elseif ? 'else-if="' + el.elseif + '"' : "else"} ` +
        `used on element <${el.tag}> without corresponding v-if.`,
      el.rawAttrsMap[el.elseif ? "v-else-if" : "v-else"]
    );
  }
}

function findPrevElement(children: Array<any>): ASTElement | void {
  let i = children.length;
  while (i--) {
    if (children[i].type === 1) {
      return children[i];
    } else {
      if (process.env.NODE_ENV !== "production" && children[i].text !== " ") {
        warn(
          `text "${children[i].text.trim()}" between v-if and v-else(-if) ` +
            `will be ignored.`,
          children[i]
        );
      }
      children.pop();
    }
  }
}

export function addIfCondition(el: ASTElement, condition: ASTIfCondition) {
  if (!el.ifConditions) {
    el.ifConditions = [];
  }
  el.ifConditions.push(condition);
}

function processOnce(el) {
  const once = getAndRemoveAttr(el, "v-once");
  if (once != null) {
    el.once = true;
  }
}

// handle content being passed to a component as slot,
// e.g. <template slot="xxx">, <div slot-scope="xxx">
/**
 * 处理作为插槽传递给组件的内容，得到
 * slotTarget => 插槽名
 * slotTargetDynamic => 是否为动态插槽
 * slotScope => 作用域插槽的值
 *
 * 直接在<comp></comp>标签上使用v-slot语法时
 * 将上述属性放到el.scopedSlot对象上，其他情况直接放到el对象上
 * @param {*} el
 */
function processSlotContent(el) {
  let slotScope;
  if (el.tag === "template") {
    /**
     * template 标签上使用scope属性的提示
     * scope 已经弃用， 并在2.5之后使用slot-scoped代替
     * slot-scoped既可以用在template标签也可用在普通标签上
     */
    slotScope = getAndRemoveAttr(el, "scope");
    /* istanbul ignore if */
    if (process.env.NODE_ENV !== "production" && slotScope) {
      warn(
        `the "scope" attribute for scoped slots have been deprecated and ` +
          `replaced by "slot-scope" since 2.5. The new "slot-scope" attribute ` +
          `can also be used on plain elements in addition to <template> to ` +
          `denote scoped slots.`,
        el.rawAttrsMap["scope"],
        true
      );
    }
    /**el.slotScope = val */
    el.slotScope = slotScope || getAndRemoveAttr(el, "slot-scope");
  } else if ((slotScope = getAndRemoveAttr(el, "slot-scope"))) {
    /* istanbul ignore if */
    if (process.env.NODE_ENV !== "production" && el.attrsMap["v-for"]) {
      /**
       * 元素不能同时使用slot-scope和v-for, v-for 具有更高的优先级
       * 应该用template标签作为容器，将slot-scope放到template标签上
       */
      warn(
        `Ambiguous combined usage of slot-scope and v-for on <${el.tag}> ` +
          `(v-for takes higher priority). Use a wrapper <template> for the ` +
          `scoped slot to make it clearer.`,
        el.rawAttrsMap["slot-scope"],
        true
      );
    }
    el.slotScope = slotScope;
  }

  // slot="xxx"
  /**
   * 获取slot属性的值
   * slot="xxx"， 旧的具名插槽的写法
   */
  const slotTarget = getBindingAttr(el, "slot");
  if (slotTarget) {
    /**el.slotTarget = 插槽名(具名插槽) */
    el.slotTarget = slotTarget === '""' ? '"default"' : slotTarget;
    /**动态插槽名 */
    el.slotTargetDynamic = !!(
      el.attrsMap[":slot"] || el.attrsMap["v-bind:slot"]
    );
    // preserve slot as an attribute for native shadow DOM compat
    // only for non-scoped slots.
    if (el.tag !== "template" && !el.slotScope) {
      addAttr(el, "slot", slotTarget, getRawBindingAttr(el, "slot"));
    }
  }

  // 2.6 v-slot syntax
  if (process.env.NEW_SLOT_SYNTAX) {
    if (el.tag === "template") {
      /**
       *
       * v-slot在template标签上，得到v-slot的值
       * v-slot on <template>
       */
      const slotBinding = getAndRemoveAttrByRegex(el, slotRE);
      if (slotBinding) {
        /**异常提示 */
        if (process.env.NODE_ENV !== "production") {
          if (el.slotTarget || el.slotScope) {
            /**不同插槽语法禁止混合使用 */
            warn(`Unexpected mixed usage of different slot syntaxes.`, el);
          }
          if (el.parent && !maybeComponent(el.parent)) {
            /**
             * <template v-slot> 只能出现在组件的根位置，比如：
             * <comp><template v-slot>xx</template></comp>
             * 不能
             * <comp>
             *  <div>
             *    <template v-slot>xx</template>
             *  </div>
             * </comp>
             */
            warn(
              `<template v-slot> can only appear at the root level inside ` +
                `the receiving component`,
              el
            );
          }
        }
        /**得到插槽名称 */
        const { name, dynamic } = getSlotName(slotBinding);
        /**插槽名 */
        el.slotTarget = name;
        /**是否为动态插槽 */
        el.slotTargetDynamic = dynamic;
        /**作用域插槽的值 */
        el.slotScope = slotBinding.value || emptySlotScopeToken; // force it into a scoped slot for perf
      }
    } else {
      // v-slot on component, denotes default slot
      /**
       * 处理组件上的v-slot， <comp v-slot:header></comp>
       * slotBinding = { name: 'v-slot:header', value: "", start, end }
       */
      const slotBinding = getAndRemoveAttrByRegex(el, slotRE);
      if (slotBinding) {
        if (process.env.NODE_ENV !== "production") {
          /**异常提示 */
          if (!maybeComponent(el)) {
            /** el 不是组件的话，提示，v-slot 只能出现在组件上或 template 标签上 */
            warn(
              `v-slot can only be used on components or <template>.`,
              slotBinding
            );
          }
          if (el.slotScope || el.slotTarget) {
            /**语法混用 */
            warn(`Unexpected mixed usage of different slot syntaxes.`, el);
          }
          if (el.scopedSlots) {
            /**为了避免作用域歧义，当存在其他命名槽时，默认槽也应该使用<template>语法 */
            warn(
              `To avoid scope ambiguity, the default slot should also use ` +
                `<template> syntax when there are other named slots.`,
              slotBinding
            );
          }
        }
        // add the component's children to its default slot
        /**将组件的孩子添加到它的默认插槽内 */
        const slots = el.scopedSlots || (el.scopedSlots = {});
        /**获取插槽名称以及是否为动态插槽 */
        const { name, dynamic } = getSlotName(slotBinding);
        /**创建一个 template 标签的 ast 对象，用于容纳插槽内容，父级是 el */
        const slotContainer = (slots[name] = createASTElement(
          "template",
          [],
          el
        ));
        /**插槽名 */
        slotContainer.slotTarget = name;
        /**是否为动态插槽 */
        slotContainer.slotTargetDynamic = dynamic;
        /**所有的孩子，将每一个孩子的 parent 属性都设置为 slotContainer */
        slotContainer.children = el.children.filter((c: any) => {
          if (!c.slotScope) {
            /**给插槽内元素设置 parent 属性为 slotContainer，也就是 template 元素 */
            c.parent = slotContainer;
            return true;
          }
        });
        slotContainer.slotScope = slotBinding.value || emptySlotScopeToken;
        // remove children as they are returned from scopedSlots now
        el.children = [];
        // mark el non-plain so data gets generated
        el.plain = false;
      }
    }
  }
}
/**
 * 解析binding， 得到插槽名称以及是否为动态插槽
 * @param {*} binding
 * @returns { name: 插槽名称, dynamic: 是否为动态插槽 }
 */
function getSlotName(binding) {
  let name = binding.name.replace(slotRE, "");
  if (!name) {
    if (binding.name[0] !== "#") {
      name = "default";
    } else if (process.env.NODE_ENV !== "production") {
      warn(`v-slot shorthand syntax requires a slot name.`, binding);
    }
  }
  return dynamicArgRE.test(name)
    ? // dynamic [name]
      { name: name.slice(1, -1), dynamic: true }
    : // static name
      { name: `"${name}"`, dynamic: false };
}

/**
 * handle <slot/> outlets 处理自闭和slot标签
 * 得到插槽名称, el.slotName
 * @param {*} el
 */
function processSlotOutlet(el) {
  if (el.tag === "slot") {
    /**得到插槽名称 */
    el.slotName = getBindingAttr(el, "name");
    if (process.env.NODE_ENV !== "production" && el.key) {
      /**显示提示， 不要在slot标签上使用key属性 */
      warn(
        `\`key\` does not work on <slot> because slots are abstract outlets ` +
          `and can possibly expand into multiple elements. ` +
          `Use the key on a wrapping element instead.`,
        getRawBindingAttr(el, "key")
      );
    }
  }
}

/**
 * 处理动态组件,<component :is="compName" />
 * 得到el.component = compName
 * @param {*} el
 */
function processComponent(el) {
  let binding;
  /**解析is属性，得到属性值， 即组件名称，el.component = compName */
  if ((binding = getBindingAttr(el, "is"))) {
    el.component = binding;
  }
  /**
   * <component :is="compName" inline-template />
   * 组件上存在inline-template 属性，进行标记：el.inlineTemplate = true
   * 表示组件开始和结束标签内的内容作为组件模板出现， 而不是作为插槽分发，方便定义组件模板
   */
  if (getAndRemoveAttr(el, "inline-template") != null) {
    el.inlineTemplate = true;
  }
}

function processAttrs(el) {
  const list = el.attrsList;
  let i, l, name, rawName, value, modifiers, syncGen, isDynamic;
  for (i = 0, l = list.length; i < l; i++) {
    name = rawName = list[i].name;
    value = list[i].value;
    if (dirRE.test(name)) {
      // mark element as dynamic
      el.hasBindings = true;
      // modifiers
      modifiers = parseModifiers(name.replace(dirRE, ""));
      // support .foo shorthand syntax for the .prop modifier
      if (process.env.VBIND_PROP_SHORTHAND && propBindRE.test(name)) {
        (modifiers || (modifiers = {})).prop = true;
        name = `.` + name.slice(1).replace(modifierRE, "");
      } else if (modifiers) {
        name = name.replace(modifierRE, "");
      }
      if (bindRE.test(name)) {
        // v-bind
        name = name.replace(bindRE, "");
        value = parseFilters(value);
        isDynamic = dynamicArgRE.test(name);
        if (isDynamic) {
          name = name.slice(1, -1);
        }
        if (
          process.env.NODE_ENV !== "production" &&
          value.trim().length === 0
        ) {
          warn(
            `The value for a v-bind expression cannot be empty. Found in "v-bind:${name}"`
          );
        }
        if (modifiers) {
          if (modifiers.prop && !isDynamic) {
            name = camelize(name);
            if (name === "innerHtml") name = "innerHTML";
          }
          if (modifiers.camel && !isDynamic) {
            name = camelize(name);
          }
          if (modifiers.sync) {
            syncGen = genAssignmentCode(value, `$event`);
            if (!isDynamic) {
              addHandler(
                el,
                `update:${camelize(name)}`,
                syncGen,
                null,
                false,
                warn,
                list[i]
              );
              if (hyphenate(name) !== camelize(name)) {
                addHandler(
                  el,
                  `update:${hyphenate(name)}`,
                  syncGen,
                  null,
                  false,
                  warn,
                  list[i]
                );
              }
            } else {
              // handler w/ dynamic event name
              addHandler(
                el,
                `"update:"+(${name})`,
                syncGen,
                null,
                false,
                warn,
                list[i],
                true // dynamic
              );
            }
          }
        }
        if (
          (modifiers && modifiers.prop) ||
          (!el.component && platformMustUseProp(el.tag, el.attrsMap.type, name))
        ) {
          addProp(el, name, value, list[i], isDynamic);
        } else {
          addAttr(el, name, value, list[i], isDynamic);
        }
      } else if (onRE.test(name)) {
        // v-on
        name = name.replace(onRE, "");
        isDynamic = dynamicArgRE.test(name);
        if (isDynamic) {
          name = name.slice(1, -1);
        }
        addHandler(el, name, value, modifiers, false, warn, list[i], isDynamic);
      } else {
        // normal directives
        name = name.replace(dirRE, "");
        // parse arg
        const argMatch = name.match(argRE);
        let arg = argMatch && argMatch[1];
        isDynamic = false;
        if (arg) {
          name = name.slice(0, -(arg.length + 1));
          if (dynamicArgRE.test(arg)) {
            arg = arg.slice(1, -1);
            isDynamic = true;
          }
        }
        addDirective(
          el,
          name,
          rawName,
          value,
          arg,
          isDynamic,
          modifiers,
          list[i]
        );
        if (process.env.NODE_ENV !== "production" && name === "model") {
          checkForAliasModel(el, value);
        }
      }
    } else {
      // literal attribute
      if (process.env.NODE_ENV !== "production") {
        const res = parseText(value, delimiters);
        if (res) {
          warn(
            `${name}="${value}": ` +
              "Interpolation inside attributes has been removed. " +
              "Use v-bind or the colon shorthand instead. For example, " +
              'instead of <div id="{{ val }}">, use <div :id="val">.',
            list[i]
          );
        }
      }
      addAttr(el, name, JSON.stringify(value), list[i]);
      // #6887 firefox doesn't update muted state if set via attribute
      // even immediately after element creation
      if (
        !el.component &&
        name === "muted" &&
        platformMustUseProp(el.tag, el.attrsMap.type, name)
      ) {
        addProp(el, name, "true", list[i]);
      }
    }
  }
}

function checkInFor(el: ASTElement): boolean {
  let parent = el;
  while (parent) {
    if (parent.for !== undefined) {
      return true;
    }
    parent = parent.parent;
  }
  return false;
}

function parseModifiers(name: string): Object | void {
  const match = name.match(modifierRE);
  if (match) {
    const ret = {};
    match.forEach((m) => {
      ret[m.slice(1)] = true;
    });
    return ret;
  }
}
/**
 * 生成attr对象
 * @param {*} attrs 属性数组
 * @returns { attrName: attrVal, ... }
 */
function makeAttrsMap(attrs: Array<Object>): Object {
  const map = {};
  for (let i = 0, l = attrs.length; i < l; i++) {
    if (
      process.env.NODE_ENV !== "production" &&
      map[attrs[i].name] &&
      !isIE &&
      !isEdge
    ) {
      warn("duplicate attribute: " + attrs[i].name, attrs[i]);
    }
    map[attrs[i].name] = attrs[i].value;
  }
  return map;
}

// for script (e.g. type="x/template") or style, do not decode content
function isTextTag(el): boolean {
  return el.tag === "script" || el.tag === "style";
}

function isForbiddenTag(el): boolean {
  return (
    el.tag === "style" ||
    (el.tag === "script" &&
      (!el.attrsMap.type || el.attrsMap.type === "text/javascript"))
  );
}

const ieNSBug = /^xmlns:NS\d+/;
const ieNSPrefix = /^NS\d+:/;

/* istanbul ignore next */
function guardIESVGBug(attrs) {
  const res = [];
  for (let i = 0; i < attrs.length; i++) {
    const attr = attrs[i];
    if (!ieNSBug.test(attr.name)) {
      attr.name = attr.name.replace(ieNSPrefix, "");
      res.push(attr);
    }
  }
  return res;
}

function checkForAliasModel(el, value) {
  let _el = el;
  while (_el) {
    if (_el.for && _el.alias === value) {
      warn(
        `<${el.tag} v-model="${value}">: ` +
          `You are binding v-model directly to a v-for iteration alias. ` +
          `This will not be able to modify the v-for source array because ` +
          `writing to the alias is like modifying a function local variable. ` +
          `Consider using an array of objects and use v-model on an object property instead.`,
        el.rawAttrsMap["v-model"]
      );
    }
    _el = _el.parent;
  }
}
