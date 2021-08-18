生成的 AST 对象

```
const element = {
  type: 1,
  tag,
  attrsList: [{ name: attrName, value: attrVal, start, end }],
  attrsMap: { attrName: attrVal, },
  rawAttrsMap: { attrName: attrVal, type: checkbox },
  // v-if
  ifConditions: [{ exp, block }],
  // v-for
  for: iterator,
  alias: 别名,
  // :key
  key: xx,
  // ref
  ref: xx,
  refInFor: boolean,
  // 插槽
  slotTarget: slotName,
  slotTargetDynamic: boolean,
  slotScope: 作用域插槽的表达式,
  scopeSlot: {
    name: {
      slotTarget: slotName,
      slotTargetDynamic: boolean,
      children: {
        parent: container,
        otherProperty,
      }
    },
    slotScope: 作用域插槽的表达式,
  },
  slotName: xx,
  // 动态组件
  component: compName,
  inlineTemplate: boolean,
  // class
  staticClass: className,
  classBinding: xx,
  // style
  staticStyle: xx,
  styleBinding: xx,
  // attr
  hasBindings: boolean,
  nativeEvents: {同 evetns},
  events: {
    name: [{ value, dynamic, start, end, modifiers }]
  },
  props: [{ name, value, dynamic, start, end }],
  dynamicAttrs: [同 attrs],
  attrs: [{ name, value, dynamic, start, end }],
  directives: [{ name, rawName, value, arg, isDynamicArg, modifiers, start, end }],
  // v-pre
  pre: true,
  // v-once
  once: true,
  parent,
  children: [],
  plain: boolean,
}
```
