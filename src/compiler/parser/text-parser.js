/* @flow */

import { cached } from "shared/util";
import { parseFilters } from "./filter-parser";

const defaultTagRE = /\{\{((?:.|\r?\n)+?)\}\}/g;
const regexEscapeRE = /[-.*+?^${}()|[\]\/\\]/g;

const buildRegex = cached((delimiters) => {
  /**$&	与 regexp 相匹配的子串。 这里的意思是遇到了特殊符号的时候在正则里面需要替换加多一个/斜杠 */

  const open = delimiters[0].replace(regexEscapeRE, "\\$&"); /**{ => \{ */
  const close = delimiters[1].replace(regexEscapeRE, "\\$&"); /**} => \} */

  return new RegExp(
    open + "((?:.|\\n)+?)" + close,
    "g"
  ); /**匹配开始的open +任意字符或者换行符+ close 全局匹配 */
});

// console.log(parseText("我叫{{name}},今年{{age}},数据{{data.number}}个手机"));

type TextParseResult = {
  expression: string,
  tokens: Array<string | { "@binding": string }>,
};

/**
 * 匹配view 指令，并且把他转换成 虚拟dom vonde 需要渲染的函数,比如指令{{name}}转换成 _s(name)
 * 比如字符串  我叫{{name}},今年{{age}},数据{{data.number}}个手机  转换成 我叫+_s(name)+,今年+_s(age)+,数据+_s(data.number)+个手机
 * @param {*} text 字符串
 * @param {*} delimiters 被修改默认的标签匹配
 * @returns
 */
export function parseText(
  text: string /**字符串 */,
  delimiters?: [string, string] /**被修改默认的标签匹配 */
): TextParseResult | void {
  /**如果delimiters不存在则 用默认指令 {{}}，如果修改成其他指令则用其他指令 */
  const tagRE = delimiters ? buildRegex(delimiters) : defaultTagRE;

  if (!tagRE.test(text)) {
    /**判断字符串是否含有指令 */
    return;
  }
  const tokens = [];
  const rawTokens = [];
  let lastIndex = (tagRE.lastIndex = 0);
  let match, index, tokenValue;

  /**循环能匹配上的指令，全局匹配代码：的时候会有个lastIndex  执行exec方法后，lastIndex就会记录匹配的字符串在原始字符串中最后一位的索引加一， */
  while ((match = tagRE.exec(text))) {
    /**
     * eg <div>我叫{{name}},今年{{age}},数据{{data.number}}个手机</div>
     * match: ["{{name}}", "name"]
     * match.index 出现{的索引
     * lastIndex 结束索引
     */

    index = match.index;
    // push text token
    if (index > lastIndex) {
      /**截取匹配到字符串指令前面的字符串，并添加到rawTokens */
      rawTokens.push((tokenValue = text.slice(lastIndex, index)));

      /**添加匹配到字符串指令前面的字符串 */
      tokens.push(JSON.stringify(tokenValue));
    }

    /**
     * tag token
     * 处理value 解析成正确的value，把过滤器 转换成vue 虚拟dom的解析方法函数 比如把过滤器 ' ab | c | d' 转换成 _f("d")(_f("c")(ab))
     */
    const exp = parseFilters(match[1].trim());
    /**
     * 把指令转义成函数，便于vonde 虚拟dom 渲染 比如指令{{name}} 转换成 _s(name)
     */
    tokens.push(`_s(${exp})`);
    /**
     * 绑定指令{{name}} 指令转换成  [{@binding: "name"}]
     */
    rawTokens.push({ "@binding": exp });
    /**
     * 上一次匹配出来的字符串的位置+上一次字符串的长度  比如字符串   我叫{{name}},今年{{age}},数据{{data.number}}个手机  这时候lastIndex 等于10
     */
    lastIndex = index + match[0].length;
  }
  if (lastIndex < text.length) {
    /**接最后一个字符， 数据{{data.number}}个手机    把个手机 的字符串连接起来 */
    rawTokens.push(
      (tokenValue = text.slice(lastIndex))
    ); /**截取字符串。到最后一位 */
    tokens.push(JSON.stringify(tokenValue)); /**拼接最后一位字符串 */
  }
  return {
    /**把数组变成字符串，用加号链接 比如数组为 ['我叫','_s(name)',',今年','_s(age)',',数据','_s(data.number)','个手机']  变成   我叫+_s(name)+,今年+_s(age)+,数据+_s(data.number)+个手机 */
    expression: tokens.join("+"),
    tokens: rawTokens,
  };
}
