/* @flow */

import { extend } from "shared/util";
import { detectErrors } from "./error-detector";
import { createCompileToFunctionFn } from "./to-function";

export function createCompilerCreator(baseCompile: Function): Function {
  /**
   * baseOptions： src/platforms/web/compiler/options
   */
  return function createCompiler(baseOptions: CompilerOptions) {
    function compile(
      /**字符串模板 */
      template: string,
      /**编译选项 */
      options?: CompilerOptions
    ): CompiledResult {
      /**平台特有的编译选项 比如web平台， 以平台特有的编译选项为原型创建最终的编译配置 */
      const finalOptions = Object.create(baseOptions);
      const errors = [];
      const tips = [];

      let warn = (msg, range, tip) => {
        (tip ? tips : errors).push(msg);
      };

      /**
       * 合并options配置和baseOptions， 将两者合并到finalOptions对象上
       */
      if (options) {
        if (
          process.env.NODE_ENV !== "production" &&
          options.outputSourceRange
        ) {
          // $flow-disable-line
          const leadingSpaceLength = template.match(/^\s*/)[0].length;
          /**增强日志 */
          warn = (msg, range, tip) => {
            const data: WarningMessage = { msg };
            if (range) {
              if (range.start != null) {
                data.start = range.start + leadingSpaceLength;
              }
              if (range.end != null) {
                data.end = range.end + leadingSpaceLength;
              }
            }
            (tip ? tips : errors).push(data);
          };
        }
        /**
         * merge custom modules
         */
        if (options.modules) {
          finalOptions.modules = (baseOptions.modules || []).concat(
            options.modules
          );
        }
        // merge custom directives
        if (options.directives) {
          finalOptions.directives = extend(
            Object.create(baseOptions.directives || null),
            options.directives
          );
        }
        // copy other options
        for (const key in options) {
          if (key !== "modules" && key !== "directives") {
            finalOptions[key] = options[key];
          }
        }
      }

      finalOptions.warn = warn;

      /**
       * 执行baseCompile得到编译结果
       */
      const compiled = baseCompile(template.trim(), finalOptions);
      if (process.env.NODE_ENV !== "production") {
        detectErrors(compiled.ast, warn);
      }
      /**执行期间产生的错误和tips */
      compiled.errors = errors;
      compiled.tips = tips;

      /**返回编译结果 */
      return compiled;
    }

    return {
      compile,
      compileToFunctions: createCompileToFunctionFn(compile),
    };
  };
}
