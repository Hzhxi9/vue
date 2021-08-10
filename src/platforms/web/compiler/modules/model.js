/* @flow */

/**
 * Expand input[v-model] with dynamic type bindings into v-if-else chains
 * Turn this:
 *   <input v-model="data[type]" :type="type">
 * into this:
 *   <input v-if="type === 'checkbox'" type="checkbox" v-model="data[type]">
 *   <input v-else-if="type === 'radio'" type="radio" v-model="data[type]">
 *   <input v-else :type="type" v-model="data[type]">
 */

import { addRawAttr, getBindingAttr, getAndRemoveAttr } from "compiler/helpers";

import {
  processFor,
  processElement,
  addIfCondition,
  createASTElement,
} from "compiler/parser/index";
/**
 * 处理存在v-model的input标签，但没处理v-model属性
 *
 * 分别处理了input为checkbox、radio和其他情况
 * input 具体是哪种情况由el.ifConditions中的条件来判断
 *
 * <input v-model="value" :type="checkbox or radio orr other(比如text)" />
 * @param {*} el
 * @param {*} options
 * @returns branch0
 */
function preTransformNode(el: ASTElement, options: CompilerOptions) {
  /**
   * 处理包含v-model指令的input标签
   * <input v-model="value" />
   **/
  if (el.tag === "input") {
    const map = el.attrsMap;
    /**不存在v-model直接结束 */
    if (!map["v-model"]) {
      return;
    }

    let typeBinding;
    /**获取:type的值 */
    if (map[":type"] || map["v-bind:type"]) {
      typeBinding = getBindingAttr(el, "type");
    }
    if (!map.type && !typeBinding && map["v-bind"]) {
      typeBinding = `(${map["v-bind"]}).type`;
    }

    /**存在type */
    if (typeBinding) {
      /**
       * 得到指定属性 v-if表达式的值 ifCondition = xx
       * <input v-model="value" v-if="xx" />
       */
      const ifCondition = getAndRemoveAttr(el, "v-if", true);
      /**拼接&&xx */
      const ifConditionExtra = ifCondition ? `&&(${ifCondition})` : ``;
      /**v-else指令 */
      const hasElse = getAndRemoveAttr(el, "v-else", true) != null;
      /**v-else-if */
      const elseIfCondition = getAndRemoveAttr(el, "v-else-if", true);

      /**
       * 克隆出一个新的el对象，分别处理input为CheckBox、radio、或其他情况
       * 具体是那种情况通过el.ifCondition条件来判断
       */

      // 1. checkbox <input type="checkbox" />
      const branch0 = cloneASTElement(el);

      /**
       * process for on the main node
       * 处理v-for = "item in arr" 得到 branch0.for = arr, branch0.alias = item
       */
      processFor(branch0);
      /**
       * 在 branch0.attrsMap 和 branch0.attrsList 对象中添加 type 属性
       */
      addRawAttr(branch0, "type", "checkbox");
      /**
       * 分别处理元素节点的key、ref、插槽、自闭合slot标签、动态组件、class、style、v-bind、v-on、其他指令、和一些元素属性
       */
      processElement(branch0, options);
      /**
       * 标记当前对象已经被处理过了
       */
      branch0.processed = true; // prevent it from double-processed
      /**
       * 得到 true&&test or false&&test，标记当前 input 是否为 checkbox
       */
      branch0.if = `(${typeBinding})==='checkbox'` + ifConditionExtra;
      /**
       * 在 branch0.ifConfitions 数组中放入 { exp, block } 对象
       */
      addIfCondition(branch0, {
        exp: branch0.if,
        block: branch0,
      });

      // 2. add radio else-if condition  checkbox <input type="radio" />
      /**
       * 克隆一个新的ast对象
       */
      const branch1 = cloneASTElement(el);
      /**处理v-for */
      getAndRemoveAttr(branch1, "v-for", true);
      /**
       * 添加type属性
       * 在 branch1.attrsMap 和 branch1.attrsList 对象中添加 type 属性
       */
      addRawAttr(branch1, "type", "radio");
      /**
       * 分别处理元素节点的 key、ref、插槽、自闭合的 slot 标签、动态组件、class、style、v-bind、v-on、其它指令和一些原生属性
       */
      processElement(branch1, options);
      /**
       * 在 branch0.ifConfitions 数组中放入 { exp, block } 对象
       */
      addIfCondition(branch0, {
        // 标记当前 input 是否为 radio
        exp: `(${typeBinding})==='radio'` + ifConditionExtra,
        block: branch1,
      });

      // 3. other input 为其它的情况
      const branch2 = cloneASTElement(el);
      getAndRemoveAttr(branch2, "v-for", true);
      addRawAttr(branch2, ":type", typeBinding);
      processElement(branch2, options);
      addIfCondition(branch0, {
        exp: ifCondition,
        block: branch2,
      });

      /**给 branch0 设置 else 或 elseif 条件 */
      if (hasElse) {
        branch0.else = true;
      } else if (elseIfCondition) {
        branch0.elseif = elseIfCondition;
      }

      return branch0;
    }
  }
}

/**
 * 克隆一个新的ast对象
 * @param {*} el
 * @returns
 */
function cloneASTElement(el) {
  return createASTElement(el.tag, el.attrsList.slice(), el.parent);
}

export default {
  preTransformNode,
};
