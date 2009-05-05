/*global $p, alert, console */
var $p = {};
(function(pure){
	var clone = function(node){
		return node.cloneNode(true);
	};
	var error = function(e){
		alert(e);
		console.log(e);
		debugger;
		throw('pure error: ' + e);
	};
	var config = {
		//default to browser internal selector
		find: function(n, sel){
			return (n||document).querySelector( sel );
		},
		autoAtt:'class'
	};
	//if IE take the internal method otherwise build one
	var outerHTML = function(node){
		return node.outerHTML || (function(node){
        	var div = document.createElement('div');
	        div.appendChild(node);
	        return div.innerHTML;})(node);
	};

	var wrapquote = function(qfn, f){
		return function(ctxt){
			return qfn('' + f(ctxt));
		};
	};

	var walk = function(n, bf, af) {
		n = n.firstChild;
		while (n) {
			if(bf(n)){ //if true, stop this branch
				return;
			};
			walk(n, bf, af);
			af(n);
			n = n.nextSibling;
		}
	};

	var getAtt =  config.autoAtt === 'class' ? 
		function(node){return node.className;}:
		function(node){return node.getAttribute(config.autoAtt);};

	// create a function that concatenates constant string
	// sections (given in parts) and the results of called
	// functions to fill in the gaps between parts (fns).
	// fns[n] fills in the gap between parts[n-1] and parts[n];
	// fns[0] is unused.
	// this is the inner template evaluation loop.
	var concatenator = function(parts, fns){
		return function(ctxt){
			var strs = [parts[0]];
			var n = parts.length;
			for(var i = 1; i < n; i++){
				strs[strs.length] = fns[i](ctxt);
				strs[strs.length] = parts[i];
			}
			return strs.join('');
		};
	};

	var parseloopspec = function(p){
		var m = p.match(/^(\w+)\s*<-\s*(\S+)$/);
		if(m === null){
			error('bad loop spec: "' + p + '"');
		}
		return {name: m[1], sel: m[2]};
	};

	// parse a data selector and return a function that
	// can traverse the data accordingly, given a context.
	var dataselectfn = function(sel){
		if(typeof(sel) === 'function'){
			return sel;
		}
		var m = sel.match(/^(\w+)(\.(\w+))*$/);
		if(!m){
			var found = false;
			var s = sel;
			var parts = [];
			var pfns = [];
			var i = 0;
			while((m = s.match(/#\{([^{}]+)\}/)) !== null){
				found = true;
				parts[i++] = s.slice(0, m.index);
				pfns[i] = dataselectfn(m[1]);
				s = s.slice(m.index + m[0].length, s.length);
			}
			parts[i] = s;
			if(!found){
				error('bad data selector syntax: ' + sel);
			}
			return concatenator(parts, pfns);
		}
		m = sel.split('.');
		return function(ctxt){
			var data = ctxt.data;
			if(!data){
				return '';
			}
			var v = ctxt[m[0]];
			var i = 0;
			if(v){
				data = v.item;
				i += 1;
			}
			var n = m.length;
			for(; i < n; i++){
				if(!(data = data[m[i]])){
					return '';
				}
			}
			return data;
		};
	};

	var gettarget = function(dom, sel, isloop, node){
		var osel = sel;
		// e.g. "html | +tr.foo[class]"
		var m = sel.match(/^(\s*(\w+)\s*\|)?\s*([\+=])?(((\+[^\[])|[^\[\+])*)(\[([^\]]*)\])?([\+=])?\s*$/);
		if(!m){
			error('bad selector: ' + sel);
		}
		var qtype = m[2];
		var prepend = m[3];
		sel = m[4];
		var attr = m[8];
		var append = m[9];

		var mode = (attr || isloop) ? 'self' : 'contents';
		if(prepend || append){
			if(prepend && append){
				error('conflicting append/prepend/replace modifiers');
			}
			if(isloop){
				error('no append/prepend/replace modifiers allowed for loop target');
			}
			var c = prepend || append;
			mode = c === '=' ? 'self' : (append ? 'append' : 'prepend');
			if(mode === 'append' && isloop){
				error('cannot append with loop (sel: ' + osel + ')');
			}
		}
		// we need 'root' selector because CSS search never finds the root element.
		var target = [];
		if(node){
			target = [node];
		}else if(sel === 'root'){
			target[0] = dom;
		}else{
			target = config.find(dom, sel);
		}
		if(!target || target.length === 0){
			return {attr: null, nodes: target, set: null, sel: osel};
		}
		var setstr, getstr, quotefn;
		if(attr){
			getstr = function(node){return node.getAttribute(attr);};
			setstr = function(node, s){node.setAttribute(attr, s);};
			quotefn = function(s){
				return s.replace(/\"/g, '&quot;').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
			};
		}else{
			if(mode === 'self'){
				setstr = function(node, s){
					// we can have a null parent node
					// if we get overlapping targets.
					var pn = node.parentNode;
					if(pn){
						//replace node with s
						var t = document.createTextNode(s);
						node.parentNode.insertBefore(t, node.nextSibling);
						node.parentNode.removeChild(node);
					}
				};
			}else{
				getstr = function(node){return node.innerHTML;};
				setstr = function(node, s){node.innerHTML = s;};
			}
			quotefn = function(s){return s;};
		}
		var setfn;
		switch(mode){
		case 'prepend':
			setfn = function(node, s){setstr(node, s + getstr(node));};
			break;
		case 'self':
		case 'contents':
			setfn = function(node, s){setstr(node, s);};
			break;
		case 'append':
			setfn = function(node, s){setstr(node, getstr(node) + s);};
			break;
		}
		return {attr: attr, nodes: target, set: setfn, sel: osel, quotefn: quotefn};
	};

	var Sig = 'r'+Math.floor(Math.random()*1000000)+'S';		

	var setsig = function(target, n){
		var sig = Sig + n + ':';
		for(var i = 0; i < target.nodes.length; i++){
			// could check for overlapping targets here.
			target.set(target.nodes[i], sig);
		}
	};

	var render0;				// for JSLint - defined later.

	var loopfn = function(name, dselect, inner){
		return function(ctxt){
			var a = dselect(ctxt);
			var oldvctxt = ctxt[name];
			var vctxt = {items: a};
			ctxt[name] = vctxt;
			var n = (a && a.length) || 0;
			var strs = [];
			for(var i = 0; i < n; i++){
				ctxt.pos = vctxt.pos = i;
				ctxt.item = vctxt.item = a[i];
				strs.push(inner(ctxt));
			}
			ctxt[name] = oldvctxt;
			return strs.join('');
		};
	};

	var loopgen = function(dom, sel, loop, fns, currNode, data){
		var already = false;
		var p, dsel;
		if(loop){
			for(var i in loop){
				if(loop.hasOwnProperty(i)){
					if(already){
						error('cannot have more than one loop on a target');
					}
					p = i;
					already = true;
				}
			}
			if(!p){
				error('no loop spec');
			}
			dsel = loop[p];
		}else{
			dsel = {};
			p = sel+'<-'+sel;
		}
		// if it's a simple data selector then we default to contents, not replacement.
		if(typeof(dsel) === 'string' || typeof(dsel) === 'function'){
			loop = {};
			loop[p] = {root: dsel};
			return loopgen(dom, sel, loop, fns);
		}
		var spec = parseloopspec(p);
		var itersel = dataselectfn(spec.sel);
		var target = gettarget(dom, sel, true, currNode);
		var nodes = target.nodes;
		for(i = 0; i < nodes.length; i++){
			var node = nodes[i];
			// could check for overlapping loop targets here by checking that
			// root is still ancestor of node.
			var inner = render0(node, dsel, data);
			fns[fns.length] = wrapquote(target.quotefn, loopfn(spec.name, itersel, inner));
			target.nodes = [node];		// N.B. side effect on target.
			setsig(target, fns.length - 1);
		}
	};

	// render0 returns a function that, given a context argument,
	// will render the template defined by dom and directive.
	// NB. declared above.
	render0 = function(dom, directive, data){
		var fns = [];
		dom = clone(dom);

		var buildLoops = function(sel, dsel, fns, node){
			var val = dataselectfn(sel[2])({data:data});
			if(typeof val === 'object'){ //array or object
				loopgen(dom, sel[2], false, fns, node, data);
				return true;
			}else{
				return false;
			}
		};
		var buildParts = function(sel, dsel, fns, node){
			var target;
			if(typeof(dsel) === 'function' || typeof(dsel) === 'string'){
				target = gettarget(dom, sel, false);
				setsig(target, fns.length);
				fns[fns.length] = wrapquote(target.quotefn, dataselectfn(dsel));
			}else{
				loopgen(dom, sel, dsel, fns, node, data);
			}
		};

		for(var sel in directive){
			if(directive.hasOwnProperty(sel)){
				var dsel = directive[sel];
				buildParts(sel, dsel, fns);
			}
		}
		
		if(data){
			var forEachClass = function(node, cb){
				var a, c, i = 0, l, sel, val, stopWalk;
				c = getAtt(node);
				if(c){
					a = c.split(' ');
					l = a.length;
					for(;i<l;i++){
						sel = a[i].match(/(\+)?([^\@\+]+)@?(\w+)?(\+)?/);
//						if(typeof val.length === 'number' && !(val.propertyIsEnumerable('length')) && typeof val.splice === 'function'){
//							(sel[1]||'')+sel[2]+(sel[3] ? '['+sel[3]+']':'')+(sel[4]||''),
						isLoop = cb(sel, {}, fns, node);
						if(isLoop){
							stopWalk = true;
						}
					}
					return stopWalk;
				}
			};
			walk(dom, 
				//before walk
				function(node){
					if(node.nodeType === 1) {
						return forEachClass(node, buildLoops);}
				},
				//after walk
				function(node){
					if(node.nodeType === 1) {
						return forEachClass(node, buildParts);}
				}
			);
		}

		var h = outerHTML(dom);
		var parts = h.split(Sig);
		var pfns = [];
		for(var i = 1; i < parts.length; i++){
			var p = parts[i];
			// part is of the form "fn-number:..." as placed there by setsig.
			pfns[i] = fns[parseInt(p, 10)];
			parts[i] = p.slice(p.indexOf(':') + 1, p.length);
		}
		return concatenator(parts, pfns);
	};
	
	pure.compile = function(template, directive, ctxt){
		var rfn = render0(template, directive, ctxt);
		return function(data){
			return rfn({data: data});
		};
	};
	pure.config = function(cfg){
		if(cfg){
			config = cfg;
		}
		return config;
	};

	pure.render = function(template, directive, data){
		var rfn = pure.compile(template, directive);
		return rfn(data);
	};
	pure.autoRender = function(template, directive, data){
		var rfn = pure.compile(template, directive, data);
		return rfn(data);
	};
}($p));
