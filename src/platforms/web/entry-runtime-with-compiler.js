/* @flow */

import config from "core/config";
import { warn, cached } from "core/util/index";
import { mark, measure } from "core/util/perf";

import Vue from "./runtime/index";
import { query } from "./util/index";
import { compileToFunctions } from "./compiler/index";
import {
  shouldDecodeNewlines,
  shouldDecodeNewlinesForHref,
} from "./util/compat";

/**
 * 通过id获取innerHTML
 */
const idToTemplate = cached((id) => {
  const el = query(id);
  return el && el.innerHTML;
});

/**
 * $mount 备份
 */
const mount = Vue.prototype.$mount;

/**
 * 编译器的入口
 *
 * 找到入口的方法
 * 1. 断点调试，初始化最后一步是执行$mount进行挂载，在全量的Vue包中这一步就会进入编译阶段
 * 2. 通过rollup的配置文件一步步的找
 *
 * 运行时的Vue就没有这部分的代码，通过打包器结合vue-loader+vue-compiler-utils 进行预编译
 * 将模板编译成render函数
 *
 * 复写$mount，得到组件的渲染函数，将其设置到this.$options上
 *
 *
 * 优先级判断
 * render(存在， 直接跳过编译阶段，运行mount挂载) > template(解析template， 转换为render函数) > el(解析el， 转换为render函数)
 *
 *
 * @param {*} el 挂载点
 * @param {*} hydrating
 * @returns
 */
Vue.prototype.$mount = function (
  el?: string | Element,
  hydrating?: boolean
): Component {
  /**得到挂载点 */
  el = el && query(el);

  /* istanbul ignore if */
  if (el === document.body || el === document.documentElement) {
    /**挂载点不能是body或者html */
    process.env.NODE_ENV !== "production" &&
      warn(
        `Do not mount Vue to <html> or <body> - mount to normal elements instead.`
      );
    return this;
  }

  /**配置选项 */
  const options = this.$options;

  /**
   * resolve template/el and convert to render function
   * { render: () => {} }
   */
  if (!options.render) {
    /**从选项中获取template */
    let template = options.template;

    /**
     *  <div id="app">innerHTML</div>
     *  innerHTML: innerHTML
     *  outerHTML: <div id="app">innerHTML</div>
     */

    if (template) {
      /**处理template */
      if (typeof template === "string") {
        /**id选择器 */
        if (template.charAt(0) === "#") {
          /**
           * innerHTML
           * { template: "#app"}, template是一个id选择器， 则获取该元素的innerHTML作为模板
           **/
          template = idToTemplate(template);
          /* istanbul ignore if */
          if (process.env.NODE_ENV !== "production" && !template) {
            warn(
              `Template element not found or is empty: ${options.template}`,
              this
            );
          }
        }
      } else if (template.nodeType) {
        /**
         * innerHTML
         * template 是一个正常的元素，获取其interHTML作为模板
         **/
        template = template.innerHTML;
      } else {
        if (process.env.NODE_ENV !== "production") {
          warn("invalid template option:" + template, this);
        }
        return this;
      }
    } else if (el) {
      /**
       * outerHTML
       * 设置了el选项，获取el选择器的outerHTML作为模板
       **/
      template = getOuterHTML(el);
    }
    if (template) {
      /**模板就绪， 进入编译阶段 */
      /* istanbul ignore if */
      if (process.env.NODE_ENV !== "production" && config.performance && mark) {
        mark("compile");
      }

      /**
       * 进入编译阶段
       * 编译模板
       * render: 动态渲染函数
       * staticRenderFns: 静态渲染函数
       */
      const { render, staticRenderFns } = compileToFunctions(
        template,
        {
          /**
           * 在非生产环境下，编译时记录标签属性在模板字符串中开始和结束的位置索引
           * 标记元素在HTML模板字符串中的开始和结束的索引位置
           **/
          outputSourceRange: process.env.NODE_ENV !== "production",
          /**IE在属性值内编码换行，而其他浏览器则不编码 */
          shouldDecodeNewlines,
          /**chrome将内容编码为[href] */
          shouldDecodeNewlinesForHref,
          /**界定符， 默认({}) */
          delimiters: options.delimiters,
          /**是否保留注释 */
          comments: options.comments,
        },
        this
      );
      /**将两个渲染函数放到this.$options上 */
      options.render = render;
      options.staticRenderFns = staticRenderFns;

      /* istanbul ignore if */
      if (process.env.NODE_ENV !== "production" && config.performance && mark) {
        mark("compile end");
        measure(`vue ${this._name} compile`, "compile", "compile end");
      }
    }
  }

  /**
   * options存在render选项，直接走这里
   * 执行挂载
   */
  return mount.call(this, el, hydrating);
};

/**
 * Get outerHTML of elements, taking care
 * of SVG elements in IE as well.
 * 获取元素的outerHTML
 */
function getOuterHTML(el: Element): string {
  if (el.outerHTML) {
    /**
     *  DOM接口的outerHTML属性获取描述元素（包括其后代）的序列化HTML片段。它也可以设置为用从给定字符串解析的节点替换元素
     */
    return el.outerHTML;
  } else {
    /**
     * 不存在就创建div
     */
    const container = document.createElement("div");
    container.appendChild(el.cloneNode(true));
    return container.innerHTML;
  }
}

Vue.compile = compileToFunctions;

export default Vue;
