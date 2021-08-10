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

      // 1. checkbox <input type="checkbox" />
      const branch0 = cloneASTElement(el);

      /**
       * process for on the main node
       * 处理v-for = "item in arr"
       */
      processFor(branch0);
      /**
       *
       */
      addRawAttr(branch0, "type", "checkbox");
      processElement(branch0, options);
      branch0.processed = true; // prevent it from double-processed
      branch0.if = `(${typeBinding})==='checkbox'` + ifConditionExtra;
      addIfCondition(branch0, {
        exp: branch0.if,
        block: branch0,
      });

      // 2. add radio else-if condition  checkbox <input type="radio" />
      const branch1 = cloneASTElement(el);
      /**处理v-for */
      getAndRemoveAttr(branch1, "v-for", true);
      /**添加type属性 */
      addRawAttr(branch1, "type", "radio");
      processElement(branch1, options);
      addIfCondition(branch0, {
        exp: `(${typeBinding})==='radio'` + ifConditionExtra,
        block: branch1,
      });

      // 3. other
      const branch2 = cloneASTElement(el);
      getAndRemoveAttr(branch2, "v-for", true);
      addRawAttr(branch2, ":type", typeBinding);
      processElement(branch2, options);
      addIfCondition(branch0, {
        exp: ifCondition,
        block: branch2,
      });

      if (hasElse) {
        branch0.else = true;
      } else if (elseIfCondition) {
        branch0.elseif = elseIfCondition;
      }

      return branch0;
    }
  }
}

function cloneASTElement(el) {
  return createASTElement(el.tag, el.attrsList.slice(), el.parent);
}

export default {
  preTransformNode,
};
