<script>
  import { appendScript, consoleMsg } from "../utils.js";
  import { onMount } from "svelte";
  import NavBar from "../components/NavBar.svelte";
  import Editor from "../components/Editor.svelte";
  appendScript("/ruby/ruby_main.js", initRuby);
  let outputConsole, editor;
  let runCode = () => {};

  function initRuby() {
    runCode = () => {
      let rubyCode = editor.getValue();
      let ascii_array = [];
      for (var i = 0; i < rubyCode.length; i++)
        ascii_array.push(rubyCode[i].charCodeAt(0));

      // Allocate Int32Array and fill with ascii data
      const typedArray = new Int32Array(ascii_array.length);
      for (let i = 0; i < ascii_array.length; i++) {
        typedArray[i] = ascii_array[i];
      }

      var len = typedArray.length;
      var bytes_per_element = typedArray.BYTES_PER_ELEMENT; // 4 bytes each element

      // Allocate memory on wasm heap.
      let ptr = window.RUBY._malloc(
        typedArray.length * typedArray.BYTES_PER_ELEMENT
      );
      window.RUBY.HEAP32.set(typedArray, ptr / typedArray.BYTES_PER_ELEMENT);

      //call wasm func
      var result = window.RUBY._ruby_exec(ptr, typedArray.length);
      let output = window.RUBY_STDOUT
        ? window.RUBY_STDOUT
        : 'No output. Try writing something valid to "puts".';
      outputConsole.innerHTML = consoleMsg + output + "</p>";
      outputConsole.scrollTop = outputConsole.scrollHeight;
      window.RUBY_STDOUT = "";
    };
  }
</script>

<NavBar showButtons={true} {runCode} lang="ruby" {editor} />
<div class="row editor-row">
  <div class="col-1" />
  <div class="col-10 col-sm-6 mb-3">
    <Editor bind:editor language={'ruby'} />
  </div>
  <div class="col-10 col-sm-4 mx-auto">
    <div bind:this={outputConsole} class="console" />
  </div>
  <div class="col-sm-1" />
</div>
