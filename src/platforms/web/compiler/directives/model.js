/* @flow */

import config from "core/config";
import { addHandler, addProp, getBindingAttr } from "compiler/helpers";
import {
  genComponentModel,
  genAssignmentCode,
} from "compiler/directives/model";

let warn;

// in some cases, the event used has to be determined at runtime
// so we used some reserved tokens during compile.

/**
 * 在某些情况下，使用的事件必须在运行时确定
 * 因此我们在编译期间使用了一些保留的令牌。
 **/
export const RANGE_TOKEN = "__r"; /**虚拟dom渲染函数 */
export const CHECKBOX_RADIO_TOKEN = "__c";

/**
 * 根据判断虚拟dom的标签类型是什么？给相应的标签绑定 相应的 v-model 双数据绑定代码函数
 * @param {*} el 虚拟dom
 * @param {*} dir v-model 属性的key和值
 * @param {*} _warn 警告日志函数
 * @returns
 */
export default function model(
  el: ASTElement,
  dir: ASTDirective,
  _warn: Function
): ?boolean {
  warn = _warn;
  const value = dir.value;
  const modifiers = dir.modifiers;
  const tag = el.tag;
  const type = el.attrsMap.type;

  if (process.env.NODE_ENV !== "production") {
    // inputs with type="file" are read only and setting the input's
    // value will throw an error.
    if (tag === "input" && type === "file") {
      warn(
        `<${el.tag} v-model="${value}" type="file">:\n` +
          `File inputs are read only. Use a v-on:change listener instead.`,
        el.rawAttrsMap["v-model"]
      );
    }
  }

  /**
   * 根据表单元素的tag标签以及type属性的值，
   * 调用不同的方法也就验证了官网所说的“随表单控件类型不同而不同。
   * 这里调用的就是genDefaultModel().
   */
  if (el.component) {
    /**
     * 如果是组件
     * 组件v-model的跨平台代码生成 更新$$v 数据
     * 为虚拟dom添加model属性，
     */
    genComponentModel(el, value, modifiers);
    // component v-model doesn't need extra runtime 组件v-model不需要额外的运行时
    return false;
  } else if (tag === "select") {
    /**
     * 为虚拟dom select添加change 函数 ，change函数调用 set 去更新 select选中数据的值
     */
    genSelect(el, value, modifiers);
  } else if (tag === "input" && type === "checkbox") {
    /**
     * 为input type="checkbox" 虚拟dom添加 change 函数 ，根据v-model是否是数组，调用change函数，调用 set 去更新 checked选中数据的值
     */
    genCheckboxModel(el, value, modifiers);
  } else if (tag === "input" && type === "radio") {
    /**
     * 为虚拟dom  inpu标签 type === 'radio' 添加change 事件 更新值
     */
    genRadioModel(el, value, modifiers);
  } else if (tag === "input" || tag === "textarea") {
    /**
     * 为虚拟dom input标签   事件 更新值
     */
    genDefaultModel(el, value, modifiers);
  } else if (!config.isReservedTag(tag)) {
    /**
     * 保留标签 判断是不是真的是 html 原有的标签 或者svg标签 如果不是则表示是组件 标签
     * 组件v-model的跨平台代码生成 更新$$v 数据
     * 为虚拟dom添加model属性
     */
    genComponentModel(el, value, modifiers);
    // component v-model doesn't need extra runtime
    return false;
  } else if (process.env.NODE_ENV !== "production") {
    warn(
      `<${el.tag} v-model="${value}">: ` +
        `v-model is not supported on this element type. ` +
        "If you are working with contenteditable, it's recommended to " +
        "wrap a library dedicated for that purpose inside a custom component.",
      el.rawAttrsMap["v-model"]
    );
  }

  // ensure runtime directive metadata
  return true;
}

/**
 * 为input type="checkbox" 虚拟dom添加 change 函数 ，根据v-model是否是数组，调用change函数，调用 set 去更新 checked选中数据的值
 * @param {*} el 虚拟dom
 * @param {*} value v-model view的属性值
 * @param {*} modifiers
 */
function genCheckboxModel(
  el: ASTElement,
  value: string,
  modifiers: ?ASTModifiers
) {
  const number = modifiers && modifiers.number;
  /**获取表单的 value属性值 如果 view 是 value="1" */
  const valueBinding = getBindingAttr(el, "value") || "null";
  const trueValueBinding = getBindingAttr(el, "true-value") || "true";
  const falseValueBinding = getBindingAttr(el, "false-value") || "false";

  /**在虚拟dom中添加prop属性 */
  addProp(
    el,
    "checked",
    `Array.isArray(${value})` +
      `?_i(${value},${valueBinding})>-1` +
      (trueValueBinding === "true"
        ? `:(${value})`
        : `:_q(${value},${trueValueBinding})`)
  );

  /**
   * 更新函数绑定change事件
   * view 绑定的 v-model="item.selected" 第二个参数为
   * var $$a = item.selected,  //属性值  v-model view的属性值  item.selected是否是数组
   * $$el = $event.target,  //目标dom 真实dom
   * $$c = $$el.checked ? (true) : (false);  //是否有选中
   * if (Array.isArray($$a)) {
   *     var $$v = "1",  //获取 表单的 value属性值 如果 view 是 value="1"
   *     $$i = _i($$a, $$v); //获取到数组的索引，如果没有匹配上则是新的数据
   *     if ($$el.checked) {
   *        //更新数组的值
   *        $i < 0 && ($set(item, "selected", $$a.concat([$$v])))
   *     }else{
   *        //截取数组 更新获取到索引的数组 从匹配到到最后一位
   *        $$i > -1 && ($set(item, "selected", $$a.slice(0, $$i).concat($$a.slice($$i + 1))))
   *     }
   * }else{
   *  $set(item, "selected", $$c)
   * }
   **/
  addHandler(
    el,
    "change",
    `var $$a=${value},` +
      "$$el=$event.target," +
      `$$c=$$el.checked?(${trueValueBinding}):(${falseValueBinding});` +
      "if(Array.isArray($$a)){" +
      `var $$v=${number ? "_n(" + valueBinding + ")" : valueBinding},` +
      "$$i=_i($$a,$$v);" +
      `if($$el.checked){$$i<0&&(${genAssignmentCode(
        value,
        "$$a.concat([$$v])"
      )})}` +
      `else{$$i>-1&&(${genAssignmentCode(
        value,
        "$$a.slice(0,$$i).concat($$a.slice($$i+1))"
      )})}` +
      `}else{${genAssignmentCode(value, "$$c")}}`,
    null,
    true
  );
}

/**
 * 为虚拟dom  inpu标签 type === 'radio' 添加change 事件 更新值
 * @param {*} el
 * @param {*} value
 * @param {*} modifiers
 */
function genRadioModel(
  el: ASTElement,
  value: string,
  modifiers: ?ASTModifiers
) {
  /**是否是数字 */
  const number = modifiers && modifiers.number;

  /**获取虚拟dom view标签value属性值 */
  let valueBinding = getBindingAttr(el, "value") || "null";

  /**如果是数字 则调用_n() 转义 */
  valueBinding = number ? `_n(${valueBinding})` : valueBinding;

  addProp(el, "checked", `_q(${value},${valueBinding})`);

  /**添加事件 */
  addHandler(
    el /**虚拟dom */,
    "change" /**change事件 */,
    genAssignmentCode(
      value,
      valueBinding
    ) /**事件函数,返回 key"=" valueBinding或者 $set(object[info],key,valueBinding) */,
    null /**modifiers, //事件类型状态状态 */,
    true /**根据important为true 把事件添加在前面 假就添加在尾部 */
  );
}

/**
 * 为虚拟dom添加change 函数 ，change函数调用 set 去更新 select选中数据的值
 * @param {*} el
 * @param {*} value
 * @param {*} modifiers
 */
function genSelect(el: ASTElement, value: string, modifiers: ?ASTModifiers) {
  const number = modifiers && modifiers.number;
  const selectedVal =
    `Array.prototype.filter` +
    `.call($event.target.options,function(o){return o.selected})` +
    `.map(function(o){var val = "_value" in o ? o._value : o.value;` +
    `return ${number ? "_n(val)" : "val"}})`;

  const assignment =
    "$event.target.multiple ? $$selectedVal : $$selectedVal[0]";
  let code = `var $$selectedVal = ${selectedVal};`;

  /**这里字符串js意思是。先执行Array.prototype.filter 获取到值之后 在调用 $set(object[info],key,value) 更新数据 */
  code = `${code} ${genAssignmentCode(
    value /**v-model属性值 */,
    assignment /**$$selectedVal是select选中数据的值 */
  )}`;

  /**在把这个事件添加到change事件中 */
  addHandler(el, "change", code, null, true);
}

/**
 * 如果虚拟dom标签是  'input' 类型不是checkbox，radio 或者是'textarea' 标签的时候，获取真实的dom的value值调用 change或者input方法执行set方法更新数据
 * @param {*} el
 * @param {*} value
 * @param {*} modifiers
 */
function genDefaultModel(
  el: ASTElement,
  value: string /**属性在view 的值 */,
  modifiers: ?ASTModifiers /**标签类型对象  修饰符 */
): ?boolean {
  /**获取类型 */
  const type = el.attrsMap.type;

  // warn if v-bind:value conflicts with v-model 警告如果v-bind:值与v-model冲突
  // except for inputs with v-bind:type 除了输入v-bind:type
  if (process.env.NODE_ENV !== "production") {
    const value = el.attrsMap["v-bind:value"] || el.attrsMap[":value"];
    const typeBinding = el.attrsMap["v-bind:type"] || el.attrsMap[":type"];
    if (value && !typeBinding) {
      /**如果type属性没有则发出警告 */
      const binding = el.attrsMap["v-bind:value"] ? "v-bind:value" : ":value";
      warn(
        `${binding}="${value}" conflicts with v-model on the same element ` +
          "because the latter already expands to a value binding internally",
        el.rawAttrsMap[binding]
      );
    }
  }

  const {
    lazy /**只有在焦点不集中时，才应该更新带有lazy的输入 失去焦点 */,
    number /**数字 */,
    trim /**去除两边空格 */,
  } = modifiers || {};

  /**如果不是滑动类型input */
  const needCompositionGuard = !lazy && type !== "range";

  /**获取类型事件 可以是change或者是input 事件 */
  const event = lazy
    ? "change"
    : type === "range" /**判断是否是滑动块*/
    ? RANGE_TOKEN /**'__r'虚拟dom渲染函数 */
    : "input";

  let valueExpression = "$event.target.value";
  if (trim) {
    /**获取真实dom的value */
    valueExpression = `$event.target.value.trim()`;
  }
  if (number) {
    valueExpression = `_n(${valueExpression})`;
  }

  /**
   * 更新值
   * 返回 key"=" value
   * 或者 $set(object[info],key,value)
   */
  let code = genAssignmentCode(
    value /**v-model 的属性值 */,
    valueExpression /**真实dom的value */
  );
  if (needCompositionGuard) {
    /**如果不是滑动块 */
    code = `if($event.target.composing)return;${code}`;
  }

  /**添加props 属性 */
  addProp(el, "value", `(${value})`);

  /**添加绑定事件 */
  addHandler(
    el /**虚拟dom */,
    event /**事件类型 */,
    code /**事件函数 */,
    null /**事件类型状态状态 修饰符 */,
    true /**根据important为true 把事件添加在前面 假就添加在尾部 */
  );
  if (trim || number) {
    addHandler(el, "blur", "$forceUpdate()");
  }
}
