/* @flow */

import { noop, extend } from "shared/util";
import { warn as baseWarn, tip } from "core/util/debug";
import { generateCodeFrame } from "./codeframe";

type CompiledFunctionResult = {
  render: Function,
  staticRenderFns: Array<Function>,
};

function createFunction(code, errors) {
  try {
    return new Function(code);
  } catch (err) {
    errors.push({ err, code });
    return noop;
  }
}

export function createCompileToFunctionFn(compile: Function): Function {
  const cache = Object.create(null);

  /**
   *  1. 执行编译函数，得到编译结果 => compiled
   *  2. 处理编译期间产生的error和tip， 分别输出到控制台
   *  3. 将编译得到字符串代码通过new Function(codeStr)转换成可执行函数
   *  4. 缓存编译结果
   */
  return function compileToFunctions(
    /**字符串模板 */
    template: string,
    /**编译选项 */
    options?: CompilerOptions,
    /**组件实例 */
    vm?: Component
  ): CompiledFunctionResult {
    options = extend({}, options);
    /**日志 */
    const warn = options.warn || baseWarn;
    delete options.warn;

    /* istanbul ignore if */
    if (process.env.NODE_ENV !== "production") {
      // detect possible CSP restriction
      try {
        new Function("return 1");
      } catch (e) {
        if (e.toString().match(/unsafe-eval|CSP/)) {
          /**
           * 看起来你在一个 CSP 不安全的环境中使用完整版的 Vue.js，模版编译器不能工作在这样的环境中。
           * 考虑放宽策略限制或者预编译你的 template 为 render 函数
           */
          warn(
            "It seems you are using the standalone build of Vue.js in an " +
              "environment with Content Security Policy that prohibits unsafe-eval. " +
              "The template compiler cannot work in this environment. Consider " +
              "relaxing the policy to allow unsafe-eval or pre-compiling your " +
              "templates into render functions."
          );
        }
      }
    }

    /**
     * check cache
     * 从缓存中获取编译结果
     * 如果有缓存，则跳过编译，直接从缓存中获取上次编译的结果
     */
    const key = options.delimiters
      ? String(options.delimiters) + template
      : template;
    if (cache[key]) {
      return cache[key];
    }

    /**
     * compile，执行编译函数，得到编译结果
     */
    const compiled = compile(template, options);

    /**
     * check compilation errors/tips
     * 检查编译过程中产生的所有error和tips， 分别输出到控制台
     */
    if (process.env.NODE_ENV !== "production") {
      if (compiled.errors && compiled.errors.length) {
        if (options.outputSourceRange) {
          compiled.errors.forEach((e) => {
            warn(
              `Error compiling template:\n\n${e.msg}\n\n` +
                generateCodeFrame(template, e.start, e.end),
              vm
            );
          });
        } else {
          warn(
            `Error compiling template:\n\n${template}\n\n` +
              compiled.errors.map((e) => `- ${e}`).join("\n") +
              "\n",
            vm
          );
        }
      }
      if (compiled.tips && compiled.tips.length) {
        if (options.outputSourceRange) {
          compiled.tips.forEach((e) => tip(e.msg, vm));
        } else {
          compiled.tips.forEach((msg) => tip(msg, vm));
        }
      }
    }

    /**
     * turn code into functions
     * 编译结果，compiled.render => 字符串，是一个可执行函数的字符串
     * 转换编译得到的字符串代码， 通过new Function(code) 实现
     */
    const res = {};
    const fnGenErrors = [];
    /**
     * 通过new Function(code), 将字符串转换成函数
     */
    res.render = createFunction(compiled.render, fnGenErrors);
    /**
     * 将静态节点的函数字符串转换成可执行函数
     */
    res.staticRenderFns = compiled.staticRenderFns.map((code) => {
      return createFunction(code, fnGenErrors);
    });

    // check function generation errors.
    // this should only happen if there is a bug in the compiler itself.
    // mostly for codegen development use
    /* istanbul ignore if */
    /**处理上面代码转换过程中出现的错误，这一步一般不会报错，除非编译器本身出错了 */
    if (process.env.NODE_ENV !== "production") {
      if ((!compiled.errors || !compiled.errors.length) && fnGenErrors.length) {
        warn(
          `Failed to generate render function:\n\n` +
            fnGenErrors
              .map(({ err, code }) => `${err.toString()} in\n\n${code}\n`)
              .join("\n"),
          vm
        );
      }
    }

    /**
     * 将编译结果进行缓存
     */
    return (cache[key] = res);
  };
}
