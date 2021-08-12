/* @flow */

/**
 * Cross-platform code generation for component v-model
 *  组件v-model的跨平台代码生成 更新$$v 数据，为虚拟dom添加model属性，
 */
export function genComponentModel(
  /**AST对象 */
  el: ASTElement,
  /**绑定v-model的值 */
  value: string,
  /**修饰符 */
  modifiers: ?ASTModifiers
): ?boolean {
  /**数字，去除字符串 */
  const { number, trim } = modifiers || {};

  /**给baseValueExpression赋值一个默认的字符串 */
  const baseValueExpression = "$$v";
  let valueExpression = baseValueExpression;

  if (trim) {
    /**判断类型是否为字符串，如果是使用去空格方法，如果不是返回原值 */
    valueExpression =
      `(typeof ${baseValueExpression} === 'string'` +
      `? ${baseValueExpression}.trim()` +
      `: ${baseValueExpression})`;
  }
  if (number) {
    /**如果是数字 则用数字渲染方法 */
    valueExpression = `_n(${valueExpression})`;
  }

  /*
   * 创赋值代码，转义字符串对象拆分字符串对象  把后一位key分离出来
   * 返回 key "=" value
   * 或者 $set(object[info],key,valueExpression)
   */
  const assignment = genAssignmentCode(
    value /**绑定v-model的属性值 */,
    valueExpression /**值 */
  );

  /**
   * 如果 trim不存在，number 不存在 则 valueExpression 默认为$$v
   * 回调函数是 $set(object[info],key,$$v) 更新$$v的值
   */
  el.model = {
    value: `(${value})` /**绑定v-model 的值 */,
    expression: JSON.stringify(value) /**绑定v-model 的值 */,
    callback: `function (${baseValueExpression}) {${assignment}}` /**函数  $set(object[info],key,$$v) //$set更新值函数 */,
  };
}

/**
 * Cross-platform codegen helper for generating v-model value assignment code.
 *
 *  用于生成v-model值赋值代码的跨平台codegen助手。
 *  创赋值代码，转义字符串对象拆分字符串对象  把后一位key分离出来
 */
export function genAssignmentCode(value: string, assignment: string): string {
  const res = parseModel(value);
  if (res.key === null) {
    return `${value}=${assignment}`;
  } else {
    return `$set(${res.exp}, ${res.key}, ${assignment})`;
  }
}

/**
 * Parse a v-model expression into a base path and a final key segment.
 * Handles both dot-path and possible square brackets.
 *
 * Possible cases:
 *
 * - test
 * - test[key]
 * - test[test1[key]]
 * - test["a"][key]
 * - xxx.test[a[a].test1[key]]
 * - test.xxx.a["asa"][test1[key]]
 *
 */

let len /**字符串长度 */,
  str /**字符串 */,
  chr /**字符串编码 */,
  index /**循环索引 */,
  expressionPos /**匹配到[的索引 */,
  expressionEndPos /**匹配到]的索引， 如果匹配到一对[]就跳出循环 */;

type ModelParseResult = {
  exp: string,
  key: string | null,
};

// console.log(parseModel("object"));
// console.log(parseModel("object[info][name]"));
// console.log(parseModel("object.info.name"));
// console.log(parseModel("test[key]"));
// console.log(parseModel("test[test1[key]]"));
// console.log(parseModel('test["a"][key]'));
// console.log(parseModel("xxx.test[a[a].test1[key]]"));
// console.log(parseModel('test.xxx.a["asa"][test1[key]]'));

/**
 * 转义字符串对象拆分字符串对象  把后一位key分离出来
 * 两种情况分析1 如果数据是object.info.name的情况下 则返回是 {exp: "object.info",key: "name"}
 * 如果数据是object[info][name]的情况下 则返回是 {exp: "object[info]",key: "name"}
 */
export function parseModel(val: string): ModelParseResult {
  // Fix https://github.com/vuejs/vue/pull/7730
  // allow v-model="obj.val " (trailing whitespace)

  /**去除空格 */
  val = val.trim();
  /**获取值的长度 */
  len = val.length;

  if (
    /**这个字符串没有出现过[*/
    val.indexOf("[") < 0 ||
    /**这个字符串 没有出现过]这个符号  或者是出现位置不是在最后一位的时候 */
    val.lastIndexOf("]") < len - 1
  ) {
    /**获取最后一位出现 . 的位置 */
    index = val.lastIndexOf(".");
    if (index > -1) {
      return {
        /**丢弃最后一位 比如data.object.info.age获取data.object.info */
        exp: val.slice(0, index),
        /**获取最后一位 age */
        key: '"' + val.slice(index + 1) + '"',
      };
    } else {
      return {
        /**如果没有点 则只有一个值 */
        exp: val,
        key: null,
      };
    }
  }

  str = val;
  index = expressionPos = expressionEndPos = 0;

  while (!eof()) {
    /**
     * 循环获取字符串的编码 直到把字符编码循环完
     * 获取字符串的编码
     */
    chr = next();
    /* istanbul ignore if */
    if (isStringStart(chr)) {
      /**如果是 " 或者 ' 的时候返回真 */
      parseString(chr); /**循环匹配一对''或者""符号 */
    } else if (chr === 0x5b /** [ */) {
      /**检测 匹配[] 一对这样的=括号 */
      parseBracket(chr);
    }
  }

  return {
    exp: val.slice(0, expressionPos),
    key: val.slice(expressionPos + 1, expressionEndPos),
  };
}

/**索引加加 获取字符串的编码 */
function next(): number {
  return str.charCodeAt(++index);
}

/** 索引和字符串长度比较 如果索引大于或者等于字符串的时候返回真 */
function eof(): boolean {
  /**索引和字符串长度比较 */
  return index >= len;
}

/**如果是 " 或者 ' 的时候返回真 */
function isStringStart(chr: number): boolean {
  return chr === 0x22 /** " */ || chr === 0x27; /** ' */
}

/**检测 匹配[] 一对这样的=括号 */
function parseBracket(chr: number): void {
  let inBracket = 1;
  expressionPos = index;
  while (!eof()) {
    chr = next();
    /**如果是 " 或者 ' 的时候返回真 */
    if (isStringStart(chr)) {
      /**循环匹配一对''或者""符号 */
      parseString(chr);
      continue;
    }
    if (chr === 0x5b) inBracket++; /**匹配[ */
    if (chr === 0x5d) inBracket--; /**匹配] */
    if (inBracket === 0) {
      /**如果匹配一对[]的时候跳出循环 */
      expressionEndPos = index;
      break;
    }
  }
}

/**循环匹配一对''或者""符号 */
function parseString(chr: number): void {
  /**记录当前的' 或者 " */
  const stringQuote = chr;
  while (!eof()) {
    chr = next();
    if (chr === stringQuote) {
      /**当他们匹配上一对的时候退出循环 */
      break;
    }
  }
}
