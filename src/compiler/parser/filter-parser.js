/* @flow */

/** 匹配 ) 或 . 或 + 或 - 或 _ 或 $ 或 ] */
const validDivisionCharRE = /[\w).+\-_$\]]/;
/**
 * 处理value 解析成正确的value，把过滤器 转换成vue 虚拟dom的解析方法函数 比如把过滤器 ' ab | c | d' 转换成 _f("d")(_f("c")(ab))
 * 表达式中的过滤器解析 方法
 * @param {*} exp
 * @returns
 */

export function parseFilters(exp: string): string {
  /**是否在''中 */
  let inSingle = false;
  /**是否在""中 */
  let inDouble = false;
  /**是否在``中 */
  let inTemplateString = false;
  /**是否在\\正则中 */
  let inRegex = false;
  // 是否在 {{ 中发现一个 curly加1 然后发现一个 } curly减1 直到curly为0 说明 { .. }闭合
  let curly = 0;
  // 跟{{ 一样 有一个 [ 加1 有一个 ] 减1
  let square = 0;
  // 跟{{ 一样 有一个 ( 加1 有一个 ) 减1
  let paren = 0;
  let lastFilterIndex = 0;
  let c, prev, i, expression, filters;

  for (i = 0; i < exp.length; i++) {
    prev = c;
    c = exp.charCodeAt(i);

    if (inSingle) {
      if (c === 0x27 /** ' */ && prev !== 0x5c /** \ */) inSingle = false;
    } else if (inDouble) {
      if (c === 0x22 /** " */ && prev !== 0x5c) inDouble = false;
    } else if (inTemplateString) {
      if (c === 0x60 /** ` */ && prev !== 0x5c) inTemplateString = false;
    } else if (inRegex) {
      /**当前在正则表达式/开始 */
      if (c === 0x2f /** / */ && prev !== 0x5c) inRegex = false;
    } else if (
      /**
       * 如果在 之前不在 ' " ` / 即字符串 或者正则中
       * 那么就判断 当前字符是否是 |
       * 如果当前 字符为 |
       * 且 不在 { } 对象中
       * 且 不在 [] 数组中
       * 且不在  () 中
       * 那么说明此时是过滤器的一个 分界点
       */
      c === 0x7c /** | */ && // pipe
      exp.charCodeAt(i + 1) !== 0x7c &&
      exp.charCodeAt(i - 1) !== 0x7c &&
      !curly &&
      !square &&
      !paren
    ) {
      /**
       * 如果前面没有表达式那么说明这是第一个 管道符号 "|"
       * 再次遇到 | 因为前面 expression = 'message '
       * 执行 pushFilter()
       **/
      if (expression === undefined) {
        /**
         * first filter, end of expression
         * 过滤器表达式 就是管道符号之后开始
         */
        lastFilterIndex = i + 1;
        /**存储过滤器的 表达式 */
        expression = exp.slice(0, i).trim();
      } else {
        pushFilter();
      }
    } else {
      switch (c) {
        case 0x22:
          inDouble = true;
          break; // "
        case 0x27:
          inSingle = true;
          break; // '
        case 0x60:
          inTemplateString = true;
          break; // `
        case 0x28:
          paren++;
          break; // (
        case 0x29:
          paren--;
          break; // )
        case 0x5b:
          square++;
          break; // [
        case 0x5d:
          square--;
          break; // ]
        case 0x7b:
          curly++;
          break; // {
        case 0x7d:
          curly--;
          break; // }
      }
      if (c === 0x2f) {
        // /
        let j = i - 1;
        let p;
        // find first non-whitespace prev char
        /**查找第一个非空白的prev字符 */
        for (; j >= 0; j--) {
          p = exp.charAt(j);
          if (p !== " ") break;
        }
        if (!p || !validDivisionCharRE.test(p)) {
          inRegex = true;
        }
      }
    }
  }

  if (expression === undefined) {
    expression = exp.slice(0, i).trim();
  } else if (lastFilterIndex !== 0) {
    pushFilter();
  }
  /**
   * 获取当前过滤器的 并将其存储在filters 数组中
   * filters = [ 'filterA' , 'filterB']
   **/
  function pushFilter() {
    (filters || (filters = [])).push(exp.slice(lastFilterIndex, i).trim());
    lastFilterIndex = i + 1;
  }

  if (filters) {
    for (i = 0; i < filters.length; i++) {
      /**把过滤器封装成函数 虚拟dom需要渲染的函数 */
      expression = wrapFilter(expression, filters[i]);
    }
  }

  return expression;
}
/**
 * 生成过滤器的 表达式字符串
 *   如上面的
 *   exp = message
 *   filters = ['filterA','filterB(arg1,arg2)']
 *   第一步  以exp 为入参 生成 filterA 的过滤器表达式字符串  _f("filterA")(message)
 *   第二步 以第一步字符串作为入参 生成第二个过滤器的表达式字符串 _f("filterB")(_f("filterA")(message),arg1,arg2)
 *   => _f("filterB")(_f("filterA")(message),arg1,arg2)
 *
 * @param {*} exp  上一个过滤器的值 没有就是 表达式的值
 * @param {*} filter
 * @returns
 */
function wrapFilter(exp: string, filter: string): string {
  /**
   * 返回字符串第一次出现索引的位置
   */
  const i = filter.indexOf("(");
  if (i < 0) {
    // _f: resolveFilter
    return `_f("${filter}")(${exp})`;
  } else {
    /**
     * name 是 从字符串开始到(结束的字符串,不包含(
     * 截取字符串 arrayObject.slice(start,end)
     **/
    const name = filter.slice(0, i);
    /**
     * args是从(开始匹配，到字符串末端，不包含(
     * 如果 end 未被规定，那么 slice() 方法会选取从 start 到数组结尾的所有元素。
     */
    const args = filter.slice(i + 1);
    return `_f("${name}")(${exp}${args !== ")" ? "," + args : args}`;
  }
}
