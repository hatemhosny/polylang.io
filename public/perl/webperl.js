"use strict";

/** ***** WebPerl - http://webperl.zero-g.net *****
 * 
 * Copyright (c) 2018 Hauke Daempfling (haukex@zero-g.net)
 * at the Leibniz Institute of Freshwater Ecology and Inland Fisheries (IGB),
 * Berlin, Germany, http://www.igb-berlin.de
 * 
 * This program is free software; you can redistribute it and/or modify
 * it under the same terms as Perl 5 itself: either the GNU General Public
 * License as published by the Free Software Foundation (either version 1,
 * or, at your option, any later version), or the "Artistic License" which
 * comes with Perl 5.
 * 
 * This program is distributed in the hope that it will be useful, but
 * WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
 * See the licenses for details.
 * 
 * You should have received a copy of the licenses along with this program.
 * If not, see http://perldoc.perl.org/index-licence.html
**/

/* -- Please see the documentation at http://webperl.zero-g.net/using.html -- */

let outputBuffer = "";
var Module;
var Perl = {
	trace: false,         // user may enable this
	endAfterMain: false,  // user may enable this (before Perl.init)
	noMountIdbfs: false,  // user may enable this (before Perl.start)
	WebPerlVersion: 'v0.09-beta',  // user may read (only!) this
	state: "Uninitialized",  // user may read (only!) this
	exitStatus: undefined,   // user may read (only!) this
	Util: {},
	// internal variables:
	initStepsLeft: 2, // Must match number of Perl.initStepFinished() calls!
	readyCallback: null,
	dispatch: function (perl) {
		Perl._call_code_args = Array.prototype.slice.call(arguments, 1);
		Perl.eval(perl);
		if (Perl._call_code_error) {
			var err = Perl._call_code_error;
			delete Perl._call_code_error;
			throw err;
		}
		else {
			var rv = Perl._call_code_rv;
			delete Perl._call_code_rv;
			return rv;
		}
	},
};

Perl.output = str => {
	outputBuffer += str;
};

window.PERL_RUN = code => {
	outputBuffer = "";
	Perl._saveAndRun(code);
	if (window.PERL_OUTPUT_CALLBACK) window.PERL_OUTPUT_CALLBACK(outputBuffer);
	outputBuffer = "";
}

Perl._saveAndRun = function (script) {
	Perl.init(function () {
		var file = "/tmp/scripts.pl";
		try {
			FS.writeFile(file, script);
			console.debug("Perl: Saved script(s) to ", file, ", now running");
			Perl.start([file]);
		}
		catch (err) {
			console.error("Perl:", err);
			console.error("Save to " + file + " failed: " + err);
		} finally {
			Perl.end();
		}
	});
};

Perl.changeState = function (newState) {
	if (Perl.state == newState) return;
	var oldState = Perl.state;
	Perl.state = newState;
	for (var i = 0; i < Perl.stateChangeListeners.length; i++)
		Perl.stateChangeListeners[i](oldState, newState);
};
Perl.stateChangeListeners = [(from, to) => {
	console.debug("Perl: state changed from " + from + " to " + to);
}];
Perl.addStateChangeListener = function (handler) {
	Perl.stateChangeListeners.push(handler);
};

Perl.outputLine = text => { // internal function
	if (arguments.length > 2) text = Array.prototype.slice.call(arguments, 1).join(' ');
	Perl.output(text);
	Perl.output("\n");
};
Perl.outputChar = c => { // internal function
	Perl.output(String.fromCharCode(c));
};

Perl.init = function (readyCallback) {
	if (Perl.state === "Ended") {
		Perl.changeState("Ready");
		if (readyCallback) return readyCallback();
	}
	if (Perl.state != "Uninitialized")
		throw "Perl: can't call init in state " + Perl.state;
	Perl.changeState("Initializing");
	// Note that a lot of things still won't work for file:// URLs because of the Same-Origin Policy.
	// see e.g. https://developer.mozilla.org/en-US/docs/Web/HTTP/CORS/Errors/CORSRequestNotHttp
	Perl.readyCallback = readyCallback;
	Module = {
		noInitialRun: true,
		noExitRuntime: true,
		print: Perl.outputLine, printErr: Perl.outputLine,
		stdout: Perl.outputChar, stderr: Perl.outputChar,
		stdin: function () { return null },
		arguments: ['--version'],
		onAbort: function () {
			console.error("Perl: Aborted (state", Perl.state, ")");
			alert("Perl aborted in state " + Perl.state);
			Perl.exitStatus = -1;
			Perl.changeState("Ended");
		},
		onExit: function (status) { // note this may be called multiple times
			if (status == 0)
				console.debug("Perl: Exit status", status, "(state", Perl.state, ")");
			else {
				console.error("Perl: Exit status", status, "(state", Perl.state, ")");
				alert("Perl exited with exit status " + status + " in state " + Perl.state);
			}
			Perl.exitStatus = status;
			Perl.changeState("Ended");
		},
		onRuntimeInitialized: function () {
			console.debug("Perl: Module.onRuntimeInitialized");
			Perl.initStepFinished();
		},
		preRun: [
			function () {
				if (Perl.noMountIdbfs) {
					console.debug("Perl: doing preRun, skipping IndexDB filesystem");
					Perl.initStepFinished();
					return;
				}
				console.debug("Perl: doing preRun, fetching IndexDB filesystem...");
				try { FS.mkdir('/mnt'); } catch (e) { }
				try { FS.mkdir('/mnt/idb'); } catch (e) { }
				FS.mount(IDBFS, {}, '/mnt/idb');
				FS.syncfs(true, function (err) {
					if (err) { console.error("Perl:", err); alert("Perl: Loading IDBFS failed: " + err); return; }
					console.debug("Perl: IndexDB filesystem ready");
					Perl.initStepFinished();
				});
			}
		],
		locateFile: function (file) {
			var wasmRe = /\.(wast|wasm|asm\.js|data)$/;
			if (wasmRe.exec(file))
				return "https://cdn.jsdelivr.net/npm/@chriskoch/perl-wasm/" + file;
			return file;
		},
	};
	if (Perl.endAfterMain) {
		Module.preRun.push(function () {
			// patch _main so that afterwards we call emperl_end_perl
			var origMain = Module._main;
			Module._main = function () {
				origMain.apply(this, arguments);
				console.debug("Perl: main() has ended, ending perl...");
				return Perl.end();
			};
		});
	}
	console.debug("Perl: Fetching Emscripten/Perl...");
	var script = document.createElement('script');
	script.async = true; script.defer = true;
	script.src = "https://cdn.jsdelivr.net/npm/@chriskoch/perl-wasm/emperl.js";
	document.getElementsByTagName('head')[0].appendChild(script);
};

Perl.initStepFinished = function () {
	if (Perl.state != "Initializing" || Perl.initStepsLeft < 1)
		throw "Perl: internal error: can't call initStepFinished in state " + Perl.state + " (" + Perl.initStepsLeft + ")";
	if (--Perl.initStepsLeft) {
		console.debug("Perl: One init step done, but " + Perl.initStepsLeft + " steps left, waiting...");
		return;
	} else console.debug("Perl: All init steps done, doing final initialization...");

	/* NOTE: Apparently, when NO_EXIT_RUNTIME is set, and exit() is called from the main program
	 * (from Module.callMain), Emscripten doesn't report this back to us via an ExitStatus exception
	 * like it does from ccall - it doesn't even call the addOnExit/ATEXIT or addOnPostRun/ATPOSTRUN
	 * handlers! So at the moment, the only reliable way I've found to catch the program exit()ing
	 * is to patch into Emscripten's (undocumented!) Module.quit... */
	var origQuit = Module.quit;
	Module.quit = function (status, exception) {
		console.debug("Perl: quit with", exception);
		Module.onExit(status);
		origQuit(status, exception);
	}

	Perl.changeState("Ready");
	if (Perl.readyCallback) Perl.readyCallback();
	Perl.readyCallback = null;
};

Perl.start = function (argv) {
	if (Perl.state != "Ready") Perl.end();
	Perl.changeState("Running");
	try {
		// Note: currently callMain doesn't seem to throw ExitStatus exceptions, see discussion in Perl.initStepFinished
		Module.callMain(argv ? argv : Module.arguments);
	}
	catch (e) {
		if (e instanceof ExitStatus) {
			console.debug("Perl: start:", e);
			Module.onExit(e.status);
		} else throw e;
	}
};

Perl.eval = function (code) {
	if (Perl.state != "Running")
		throw "Perl: can't call eval in state " + Perl.state;
	if (Perl.trace) console.debug('Perl: ccall webperl_eval_perl', code);
	try {
		return ccall("webperl_eval_perl", "string", ["string"], [code]);
	} catch (e) {
		if (e instanceof ExitStatus) {
			// the code caused perl to (try to) exit - now we need to call
			// Perl's global destruction via our emperl_end_perl() function
			Perl.end(); //TODO: Perl.end has already been called at this point (how?)
		} else throw e;
	}
};

/* Note that Emscripten apparently doesn't support re-running the program once it exits (?).
 * So at the moment, once we end Perl, that's it. The only useful effect of ending Perl is
 * that global destruction is executed and END blocks are called. But since a user may leave
 * a webpage at any moment without warning, WebPerl scripts should not rely on normal termination! */
Perl.end = function () {
	if (Perl.state != "Running") {
		if (Perl.state == "Ended") {
			console.debug("Perl: end called when already Ended");
			return;
		}
		else throw "Perl: can't call end in state " + Perl.state;
	}
	var status;
	try {
		status = ccall("emperl_end_perl", "number", [], []);
		// we know that emperl_end_perl only calls exit() on a nonzero exit code,
		// which means no ExitStatus exception gets thrown on a zero exit code,
		// so we *should* reach this point only with status==0
		if (status != 0) console.warn("emperl_end_perl returned with status", status);
		Module.onExit(status); // does Perl.changeState() for us
	}
	catch (e) {
		if (e instanceof ExitStatus) {
			console.debug("Perl: end: ", e);
			status = e.status;
			Module.onExit(e.status); // does Perl.changeState() for us
		} else throw e;
	}
	return status;
};

// Perl.next_glue_id = 0;
// Perl.GlueTable = {};
// Perl._glue_free_ids = {};
// Perl.glue = function (ref) {
// 	var id;
// 	var free_ids = Object.keys(Perl._glue_free_ids);
// 	if (free_ids.length > 0) {
// 		id = free_ids[0];
// 		delete Perl._glue_free_ids[id];
// 		if (Perl.trace) console.debug('Perl: Glue reused id', id, 'to', ref);
// 	}
// 	else {
// 		if (Perl.next_glue_id >= Number.MAX_SAFE_INTEGER)
// 			throw "Perl.GlueTable is overflowing!"
// 		id = '' + (Perl.next_glue_id++);
// 		if (Perl.trace) console.debug('Perl: Glue id', id, 'to', ref);
// 	}
// 	Perl.GlueTable[id] = ref;
// 	return id;
// }
// Perl.unglue = function (id) {
// 	if (Perl.trace) console.debug('Perl: Unglue id', id, 'from', Perl.GlueTable[id]);
// 	delete Perl.GlueTable[id];
// 	Perl._glue_free_ids[id] = 1;
// }
