//---[:Dependencies

var replaceall = require("replaceall");

//Gets the tokens from the file using lex.js
const lex = require("./lex.js");
{lex.main(process.argv[2])};

//---]

//FILE CONFIGURATION
var verbose = false;

//---[:Classes
	
	//For production rules
	var Rule = function(V, rule){
		this.id = nextRuleID++;
		this.root = V;
		this.rule = rule;
	}

	//Temporary rule for tree traversal
	var TRule = function(Rule){
		this.id = Rule.id;
		this.root = Rule.root;
		this.rule = Rule.rule;
		this.prev = null;	
		this.visited = [];	
	}

	//Nodes that form the parse tree
	var ParseNode = function(Rule, parent){
		this.parent = parent;
		this.rule = Rule;
		this.children = [];
		var term;
		if(this.rule == null)
			term = null
		else
			term = inTerminals(this.rule.root)
		this.terminal = term;
		this.value = null;
		this.finished = false;
	}

	//Used for duplicating (backing up) parse tree
	ParseNode.prototype.newNode = function(node){
		this.parent = node.parent;
		this.rule = node.rule;
		this.children = [];
		this.terminal = node.terminal;
		this.value = node.value;
		this.finished = node.finished;
	}

	//Used for printing and saving to file
	ParseNode.prototype.getText = function(tabs, minimal){

		if(minimal == undefined)
			minimal = false;

		var text = "";
		var rule = this.rule;
		var tab = "";
		var arrow = "";
		var val = "";
		var comp = "";
		if(tabs > 0)
			arrow = "L ";
		for(var i = 0; i < tabs; i++)
			tab += "|\t";
		if(this.value != null){
			if(minimal)
				val = "  =>  "+this.value;
			else
				val = "  =>  \033[32m"+this.value+"\033[37m";
		}
		if(!minimal && this.finished == true)
			comp = "\033[30m (done) \033[37m";
		if(!minimal && this.spot != undefined)
			comp += "(HERE)"
		text += tab+arrow+rule.root+val+comp+"\n";
		for (var i = 0; i < this.children.length; i++){
			text += this.children[i].getText(tabs+1, minimal);
		}
		return text;

	}

	//Used for getting the array sequence
	ParseNode.prototype.getArray = function(tabs){

		var text = "";
		for (var i = 0; i < this.children.length; i++){
			var cur = this.children[i];

			if(cur.rule.root == null)
				continue;

			for(var j = 0; j < tabs; j++)
				text += "\t";
			if(cur.value == null)
				text += "\""+cur.rule.root + "\":{\n";
			else{
				text += "\""+cur.rule.root + "\":"
				if(cur.rule.root == "\\n")
					text += "\"\\n\"";
				else
					text += "\""+cur.value+"\"";
			}
			text += this.children[i].getArray(tabs+1);

			
			if(cur.value == null){
				for(var j = 0; j < tabs; j++)
					text += "\t";
				text += "}";
			}
			if(i != this.children.length-1)
				text += ",\n";
			else
				text += "\n";
			
		}
		
		return text;

	}	

	//Saves the tree to a file
	ParseNode.prototype.save3 = function(file){
		//save to new file with similar filename + ".p3.txt"
	  	fs.writeFile(file+".p3.txt", this.getText(0,true), function(err) {
		    if(err) {
		        return print(err);
		    }
		    console.log("Saved the parse tree to "+file+".p3.txt!");
		}); 

	}

	//Saves the tree in array form to a file
	ParseNode.prototype.saveA = function(file){
		//save to new file with similar filename + ".p3.txt"
	  	fs.writeFile(file+".p3A.txt", SyntaxAnalyze("{\""+pStart.rule.root+"\":{\n"+pStart.getArray(1)+"}}"), function(err) {
		    if(err) {
		        return print(err);
		    }
		}); 

	}

	//Replaces a node. Used when finalizing a terminal
	ParseNode.prototype.replace = function(PNode){
		
		this.rule = PNode.rule;
		this.parent = PNode.parent;
		this.children = PNode.children;
		this.terminal = PNode.terminal;
		this.value = PNode.value;

	}

//--[Globals
var fs = require("fs");	//File System (file read/write)
var nextRuleID = 0;		//IDs the grammar rules
var lexemes;			//contains the loaded tokens using lex.js
var gRules;				//array of grammar rules
var nRules;				//array of new null rules
var gStart;				//Start of grammar rule
var tlist;				//array of terminals
var pStart;				//Start of parse Tree
var dStart;				//Start of duplicate parse Tree
var lastnode;			//last visited node
var dlastnode;			//duplicated last visited node
var linecounter = 1;	//counts lines
var errors = [];		//lists all syntax errors encountered
var expect;				//Expected for recovery
var recovery = [];		//Recovery replacements
var errState = [];		//Error statements
var finished = false;	//For run.js
var out = [];			//For run.js
var explocator = 0;		//For testing
//--]
//---]

//---[:Functions

//Handles printing for easy verbose checking
function print(){

	if(verbose)
		console.log(arguments[0])

}

//Loads and waits for the tokens using the lex.js 
function main(file){

	var int1 = setInterval(function(){

		if(lex.loaded()){
			getLexemes();
			clearInterval(int1);
		}else if(lex.failed()){
			clearInterval(int1);
			clearInterval(int2);
		}

	}, 1);

	var int2 = setInterval(function(){

		if(lexemes != undefined){
			out = start(file);
			clearInterval(int2);
			if(errors.length > 0)
				process.exit();
			finished = true;
		}

	},1);

	function getLexemes(){
		lexemes = lex.getLexemes();
	}

}

//compile grammar rules
function compile(){

	//Set default to white
	print("\033[37m");

	//Setup error statements
	errState = [
		{"type":"Math-Exp", "reply":"a <Mathematical Expression> (number, identifier, or '(' + <Mathematical Expression> + ')')"},
		{"type":"Term", "reply":"a <Term> (number, identifier, or '(' + <Mathematical Expression> + ')'"},
		{"type":"Exp'", "reply":"a '+' or '-' Mathematical operation"},
		{"type":"Term'", "reply":"a '*', '%' or '/' Mathematical operation"},
		{"type":"Expression", "reply":"an <Expression> (number, string, or function call)"},
		{"type":"Var-dec'", "reply":"an identifier"},
	];

	//Setup error recovery replacements
	recovery = [
		{"type":"Expression","rep":"number"},
		{"type":"Math-Exp","rep":"number"},
		{"type":"Term","rep":"number"},
		{"type":")","rep":")"},
		{"type":";","rep":";"},
		{"type":"Var-dec'","rep":"identifier"},
		{"type":"Bool","rep":"=="},
		{"type":"]","rep":"]"},
	];

	//Setup Terminal list, makes it easier to know if V or terminal
	tlist = [
				"identifier",
				"number",
				"+",
				"-",
				"*",
				"%",
				"/",
				")",
				"(",
				"{",
				"}",
				"[",
				"]",
				"var",
				"function",
				"print",
				"load",
				"while",
				"do",
				"for",
				"return",
				"if",
				"else",
				"=",
				",",
				";",
				"\\n",
			];

	gRules = [];
	nRules = [];
	gStart = new Rule("Start", null);
	gRules.push(gStart);

	pStart = new ParseNode(gStart);
	lastnode = pStart;

	//Grammar for outside functions
	gRules.push(new Rule("Start", ["Main"]));
	gRules.push(new Rule("Main", ["Fn-def", "Main'"]));
	gRules.push(new Rule("Main", ["epsilon"]));
	gRules.push(new Rule("Main'", ["newline", "Main"]));
	gRules.push(new Rule("Main'", ["epsilon"]));

	//Grammar for newline
	gRules.push(new Rule("newline", ["\\n", "newline"]))
	gRules.push(new Rule("newline", ["epsilon"]))

	//Grammar for inside function code block
	gRules.push(new Rule("Code-Block", ["Statement", "Code-Block"]))
	gRules.push(new Rule("Code-Block", ["newline", "Code-Block"]))
	gRules.push(new Rule("Code-Block", ["epsilon"]))

	//Grammar for statements
	gRules.push(new Rule("Statement", ["Return",";"]))
	gRules.push(new Rule("Statement", ["Var-dec", ";"]))
	gRules.push(new Rule("Statement", ["Asg-Exp", ";"]))
	gRules.push(new Rule("Statement", ["print-call", ";"]))
	gRules.push(new Rule("Statement", ["scan-call", ";"]));
	gRules.push(new Rule("Statement", ["save-call", ";"]))
	gRules.push(new Rule("Statement", ["Wh-loop"]))
	gRules.push(new Rule("Statement", ["For-loop"]))
	gRules.push(new Rule("Statement", ["Do-loop",";"]))
	gRules.push(new Rule("Statement", ["If"]))
	
	//Grammar for Variable Declaration
	gRules.push(new Rule("Var-dec", ["var", "Var-dec'"]));
	gRules.push(new Rule("Var-dec'", ["identifier", "Var-dec''"]));
	gRules.push(new Rule("Var-dec''", ["epsilon"]));
	gRules.push(new Rule("Var-dec''", ["=","Expression"]));
	
	//Grammar for Function Definition
	gRules.push(new Rule("Fn-def", ["function", "identifier", "(", "Fn-DefPar", ")", "{", "Code-Block", "}"]));
	gRules.push(new Rule("Fn-DefPar", ["identifier", "Fn-DefPar'"]));
	gRules.push(new Rule("Fn-DefPar", ["epsilon"]));
	gRules.push(new Rule("Fn-DefPar'", [",","identifier","Fn-DefPar'"]));
	gRules.push(new Rule("Fn-DefPar'", ["epsilon"]));

	//Grammar for Assignment expression and Function call fix
	gRules.push(new Rule("Asg-Exp", ["identifier", "Array", "Asg-Exp'"]));
	gRules.push(new Rule("Asg-Exp'", ["=", "Expression"]));
	gRules.push(new Rule("Asg-Exp'", ["Fn-call'"]));
	
	//Grammar for print call, load call, and custom-made function calls
	gRules.push(new Rule("sqroot", ["sqrt","Fn-call'"]));
	gRules.push(new Rule("len-call", ["len","Fn-call'"]));
	gRules.push(new Rule("rand-call", ["rand","Fn-call'"]));
	gRules.push(new Rule("print-call", ["print","Fn-call'"]));
	gRules.push(new Rule("scan-call", ["scan","Fn-call'"]));
	gRules.push(new Rule("load-call", ["load","Fn-call'"]));
	gRules.push(new Rule("num-call", ["num","Fn-call'"]));
	gRules.push(new Rule("save-call", ["save","Fn-call'"]));
	gRules.push(new Rule("Fn-call", ["identifier","Fn-call'"]));
	gRules.push(new Rule("Fn-call'", ["(", "Fn-Param", ")"]));

	//Grammar for Function Call params
	gRules.push(new Rule("Fn-Param", ["Expression", "Fn-Param'"]));
	gRules.push(new Rule("Fn-Param", ["epsilon"]));
	gRules.push(new Rule("Fn-Param'", [",","Fn-Param''"]));
	gRules.push(new Rule("Fn-Param''", ["Expression","Fn-Param'"]));
	gRules.push(new Rule("Fn-Param'", ["epsilon"]));

	//Grammar for Loops
	gRules.push(new Rule("Wh-loop", ["while","(","Expression",")","{","Code-Block","}"]));
	gRules.push(new Rule("For-loop", ["for","(","Statement",";","Expression",";","Expression",")","{","Code-Block","}"]));
	gRules.push(new Rule("Do-loop", ["do","{","Code-Block","}","while","(","Expression",")"]));

	//Grammar for if/-else
	gRules.push(new Rule("If", ["if", "(", "Expression", ")", "{", "Code-Block", "}", "If'"]));
	gRules.push(new Rule("If'", ["newline", "If'"]));
	gRules.push(new Rule("If'", ["else", "Else"]));
//	gRules.push(new Rule("Else", ["epsilon"]));
	gRules.push(new Rule("Else", ["{", "Code-Block", "}"]));

	//Grammar for Mathematical Expression
	gRules.push(new Rule("Math-Exp", ["Term", "Math-Exp'"]));
	gRules.push(new Rule("Math-Exp'", ["+", "Math-Exp"]));
	gRules.push(new Rule("Math-Exp'", ["-", "Math-Exp"]));
	//gRules.push(new Rule("Math-Exp", ["Expression"]));
	gRules.push(new Rule("Math-Exp'", ["epsilon"]));
	gRules.push(new Rule("Term", ["Factor", "Term'"]));
	gRules.push(new Rule("Term'", ["%", "Term"]));
	gRules.push(new Rule("Term'", ["*", "Term"]));
	gRules.push(new Rule("Term'", ["/", "Term"]));
	gRules.push(new Rule("Term'", ["epsilon"]));
	// gRules.push(new Rule("Factor", ["identifier", "ID-Exp"]));
	// gRules.push(new Rule("Factor", ["Number"]));
	// gRules.push(new Rule("Factor", ["(","Math-Exp",")"]));
	gRules.push(new Rule("Factor", ["Expression"]));
	
	//Grammar for arrays
	gRules.push(new Rule("Array", ["[","Expression","]","Array"]));
	gRules.push(new Rule("Array", ["epsilon"]));

	//Grammar for General Expression (Disseminates Expression into its known domain)
	gRules.push(new Rule("Expression", ["(","Expression",")"]));
	gRules.push(new Rule("Expression", ["load-call","Op"]));
	gRules.push(new Rule("Expression", ["num-call","Op"]));
	gRules.push(new Rule("Expression", ["len-call","Op"]));
	gRules.push(new Rule("Expression", ["rand-call","Op"]));
	gRules.push(new Rule("Expression", ["sqroot","Op"]));
	gRules.push(new Rule("Expression", ["Number", "Op"]));
	gRules.push(new Rule("Expression", ["identifier", "ID-Exp"]));
	gRules.push(new Rule("Expression", ["string", "Str-Exp"]));
	gRules.push(new Rule("Expression'", ["epsilon"]));
	gRules.push(new Rule("ID-Exp", ["Array","Op"]));	//For Arrays
	gRules.push(new Rule("ID-Exp", ["Fn-call'","Op"]));	//For function calls
	gRules.push(new Rule("ID-Exp", ["Op"]));
	gRules.push(new Rule("ID-Exp", ["epsilon"]));
	gRules.push(new Rule("Number",["number"]))
	gRules.push(new Rule("Number",["-","number"]))
	gRules.push(new Rule("Op", ["boolean", "Expression"]));
	gRules.push(new Rule("Op", ["operation", "Expression"]));
	gRules.push(new Rule("Op", ["epsilon"]));
	gRules.push(new Rule("Str-Exp",["boolean","Expression"]))
	gRules.push(new Rule("Str-Exp",["+","Expression"]))
	gRules.push(new Rule("Str-Exp",["epsilon"]))

	//Grammar for Return Statement
	gRules.push(new Rule("Return", ["return", "Expression"]));	


}

//Gets the proper error statement
function getErrStatement(type){

	for (var i = 0; i < errState.length; i++) {
		if(errState[i]["type"] == type)
			return errState[i]["reply"]
	}

	return type;

}

//Gets the replacement for certain error
function getReplacement(type){

	for (var i = 0; i < recovery.length; i++) {
		if(recovery[i]["type"] == type)
			return recovery[i]["rep"]
	}

	print("ERROR::MISSING_REPLACEMENT");
	return null;

}

//Checks if something is a terminal
function inTerminals(v){

	return tlist.indexOf(v)!=-1

}

//Checks if there exists an epsilon rule for this variable
function hasEpsilon(V){
	for (var i = 0; i < gRules.length; i++) {
		if(gRules[i].root == V && gRules[i].rule[0] == "epsilon")
			return true;
	}
	return false;	
}

//Gets the rule via id
function getRuleByID(id){

	for (var i = 0; i < gRules.length; i++) {
		if(gRules[i].id == id)
			return gRules[i];
	}
	return null

}

//Gets an array of rules by variable
function getRulesByVariable(v){

	var rules = [];
	for (var i = 0; i < gRules.length; i++) {
		if(gRules[i].root == v && gRules[i].rule != null)
			rules.push(gRules[i]);
	}
	return rules;

}

//Check if the node (especially duplicate node) is equal to the real last visited node
function equalToLast(node){

	var tcur = lastnode;
	var tnode = node;
	while(tcur.root!="Start"){
		if(tcur.id == node.id){
			tcur = tcur.parent;
			node = node.parent;
		}
		else
			return false
	}
	return true;

}

//Duplicate a subtree via recursion
function dupeSub(current){

	var dcur = new ParseNode();
	dcur.newNode(current);

	for (var i = 0; i < current.children.length; i++) {
		var child = dupeSub(current.children[i]);
		child.parent = dcur;
		dcur.children.push(child);		
	}


	if(dlastnode == undefined && lastnode == current)
		dlastnode = dcur;

	return dcur;
	
}

//Duplicate the parse tree starting at head then dupeSub its children
function dupeHead(current){

	dStart = new ParseNode();
	dStart.newNode(current);


	for (var i = 0; i < current.children.length; i++) {
		var child = dupeSub(current.children[i]);
		child.parent = dStart;
		dStart.children.push(child);
	}

	if(dlastnode == undefined && lastnode == current)
		dlastnode = dStart;

}

//Backs up tree in case of no suitable placement (for reverting)
//AutoSaved at dStart global
function duplicateTree(){

	var dStart = new ParseNode(pStart.rule);
	var current = pStart;
	dlastnode = undefined;
	dupeHead(current, dStart);

}

//Reverts the parse tree using the duplicate tree
function revert(){

	pStart = dStart
	lastnode = dlastnode

}

//Gets the next expected type by checking unfinished nodes
function getNextExpected(){

	var current = lastnode;
	var finished = current.finished;

	do{

		if(current.finished){
			current = current.parent;
			continue;
		}

		var allfinished = true;
		for (var i = 0; i < current.children.length; i++) {
			if(!current.children[i].finished){
				current = current.children[i];
				finished = false;
				break;	
			}
		}

		if(allfinished){
			current = current.parent;
			finished = current.finished;
		}

	}while(finished && current.root != "Start");

	if(!finished){

		while(current.children.length > 0){

			var hasunfchild = false;
			for (var i = 0; i < current.children.length; i++) {
				if(!current.children[i].finished){
					hasunfchild = true;
					current = current.children[i];
					break;
				}
			}
			if(hasunfchild)
				continue;

			return current;

		}

	}

	return current;

}

//Checks the subtree for the next type
function checkSubTree(current, type, value){

	//If found, use this subtree
	//Else, revert to duplicate

	if(current.finished)
		current = current.parent;

	//If there is no children, immediately generate a sequence until this point
	if(current.children.length == 0){
		print("==NO CHILDREN==\n---Immediately returning generated sequence---")
		return generateSequence(current, type, value);
	}

	do{

		//Check each children
		for (var i = 0; i < current.children.length; i++) {
			
			var child = current.children[i]
			if(!child.finished){

				//If the child matches the current type immediately use this type
				if(child.terminal && child.value == null){
					if(child.rule.root == type || child.rule.root == value){
						child.value = value;
						child.finished = true;
						lastnode = child;
						return "match";
					}
				}

				//If the child has no epsilon rule, immediately generate a sequence on this rule
				if(!hasEpsilon(child.rule.root)){
					print("==NO EPSILON==\n---Immediately returning generated sequence---")
					return generateSequence(child, type, value);
				}

				//Try generating a sequence
				var seq = generateSequence(child, type, value);
				if(seq != null){
					return seq;
				}

				//If there's no way, use epsilon rule and go up one level.
				child.value = "epsilon";
				child.finished = true;
						
			}
			
		}

		current.finished = true;
		current = current.parent;

	}while(current.rule.root != "Start");

	//Revert to duplicate if no matching rule if found
		print("<WARNING::No More Parent>")
		print("--Reverting--")
		revert();
		print("--Reverted--")
		return null;
	
}

//Temporarily expands a node for a terminal
//Returns expansion sequence
function generateSequence(current, type, value){

	//Create a path for type
	var expected = current.rule.root;
	var seq = [];
	var next = [new TRule(current.rule)];

	//Using TRule class, generate a direct path to the terminal
	while(true){

		current = next.shift();
		current.visited.push(current.id);
		
		if(current.rule == null){
			var roots = getRulesByVariable(current.root);
			for (var i = 0; i < roots.length; i++) {
				var n = new TRule(roots[i]);

				if(current.visited.indexOf(n.id)==-1){
					for (var j = 0; j < current.visited.length; j++) {
						n.visited.push(current.visited[j])
						n.prev = current;
					}
					next.push(n);
				}
			}
			//BAD EXIT
			if(next.length == 0){
				print("<WARNING::No matching rules>")
				print("--Trying to check for valid subtrees--");
				return null;
			}

			continue;
		}

		if(current.rule.indexOf(type) != -1 || current.rule.indexOf(value) != -1)
			break;

			var roots = getRulesByVariable(current.rule[0]);
			for (var i = 0; i < roots.length; i++) {
				var n = new TRule(roots[i]);
				if(current.visited.indexOf(n.id)==-1){
					for (var j = 0; j < current.visited.length; j++) {
						n.visited.push(current.visited[j])
						n.prev = current;
					}
					next.push(n);
				}
			}

		//BAD EXIT
		if(next.length == 0){
			print("<WARNING::No matching rules>")
			expect = expected;
			print("--Trying to check for valid subtrees--");
			return null;
		}
	}

	//When a rule is found, create the sequence by reversing the path from the current (last node)
	if(current.rule[0] == type || current.rule[0] == value){
		
		//trace back up
		while(current.prev != null){
			seq.unshift(current)
			current = current.prev;
		}

	}

	//If there were no paths generated
	if(seq.length == 0){
		print("<WARNING::No paths generated>")
		return null;	
	}

	return seq;

}

//Expands the main parse tree by using the last node (current), the sequence, the type, and the token (for placement)
function expand(current, sequence, type, token){
	
	//go up to the unfinished parent node first
	if(current.parent != undefined)
		while(current.parent.finished)
			current = current.parent

	if(current.finished){
		//Match node's root via siblings
		//check siblings for match
		var parent = current.parent;
		var siblings = parent.children;
		for (var i = 0; i < siblings.length; i++) {
			if(siblings[i].rule.id == sequence[0].prev.id){
				current = siblings[i];
				break;
			}
		}
	}

	var nextrule; //dequeue starting point
	//Create nodes via sequence
	while(sequence.length > 0){

		nextrule = sequence.shift();
		current.replace(new ParseNode(getRuleByID(nextrule.id), current.parent));
		
		//Use a null Rule (nRule) for finishing nodes
		for (var i = 0; i < nextrule.rule.length; i++) {
			
			var fl = false;
			var index;
			for (var j = 0; j < nRules.length; j++) {
				if(nRules[j].root == nextrule.rule[j]){
					fl = true;
					index = j;
				}

			}
			
			var child;
			if(fl)
				child = new ParseNode(nRules[index], current);
			else{
				var r = new Rule(nextrule.rule[i], null);
				nRules.push(r);
				child = new ParseNode(r, current);
			}

			current.children.push(child);
		
		}

		current = current.children[0];

	}

	//set the last node's terminal
	current.terminal = inTerminals(type);
	current.rule = {"root":type, "rule":null}
	current.value = token;
	current.finished = true;
	lastnode = current;

}

//Expands a node for the terminal then place token if good
//Manipulates the tree if good
function expandFor(type, token){

	expect = null;
	explocator++;	//debugging purpose

	//Get current node; check if terminal
		//True: check if type matches terminal
			//True: Insert token then set value
			//False: Warn then Recovery
		//False: expand to terminal until type is found
			//If expansion sequence is found: Apply expansion
			//Else: Warn then Recovery

	if(type == '\\n')
		token = type;

	var current = lastnode;
	print("========================")
	print(explocator+" [Expanding type] " + type + " => " + token)
	print("========================")

	print("[Duplication/Backup]----")
	duplicateTree();

	print("[Check Validity]--------")
	var sequence = checkSubTree(current, type, token)
	
	if(sequence == "match"){	//the lexeme matched the next terminal
		return [""];
	}
	
	//If there was no sequence generated
	if(sequence == null || sequence == undefined){
		print("==Recovery==")
		return ["R"];
	}
	
	print("[Expanding Parse Tree]--")
	expand(current, sequence, type, token);
	return [""];

}

//Check lexemes then try to expand parse tree per incoming type
function check(lexemes){

	for (var i = 0; i < lexemes.length; i++) {
		
		var lex = lexemes[i];
		//skip the space/tab
		if(lex.type == "\\s")
			continue;

		if(lex.type == "\\n"){
			linecounter++;
		}

		if(lex.type == "string"){
			var str = lex.token;
			var stra = str.split("");
			stra.shift();
			stra.pop();
			lex.token = stra.join("");
			lex.token = replaceall("\\\'", "'", lex.token)
			lex.token = replaceall("\\\"", "\"", lex.token)

		}
		
		var result = expandFor(lex.type, lex.token);

		//Recovery block
		if(result[0] == "R"){

			//No more lines to check for
			if(i == lexemes.length){
				print("<ERROR::Recovery impossible; no more succeeding lines>");
				return {"statement":"\n=======================\nFailed to compile.\n", "code":2}	
			}
			
			//check for expected and get replacement
			expect = getNextExpected().rule.root;
			print("Expected: " + expect)
			var replacement = getReplacement(expect);
			
			if(lex.type == "\\n"){
				errors.push("Error on line "+(linecounter-1)+". Expecting " + getErrStatement(expect) + " before new line (expansion " + explocator + ")");
			}
			else
				errors.push("Error on line "+linecounter+". Unexpected token \""+lex.token+"\" of type \""+lex.type+"\". Expecting " + getErrStatement(expect) + " (expansion " + explocator + ")");
			
			//expand using replacement for error recovery
			expandFor(replacement, "error recovery");

			var first = true;	//flag for not repeating error print
			var lastdupe = lastnode;
			while(lastnode.rule.root != lex.token || getNextExpected().rule.root != lex.token){
				
				duplicateTree();	//backup for testing
				var seq = checkSubTree(lastnode, lex.token, lex.type)	//check if the next token can fix the tree
				if(seq == "match"){
					break;
				}
				else if(seq != null){
					expand(lastdupe, seq, lex.token, lex.type);
					break;
				}

				//if the next token cannot, print the next token as suberror
				var temtok = lex.token;
				//skip the space/tab
				if(lex.type == "\\s"){
					i++;
				
					if(i == lexemes.length){
						print("<ERROR::Recovery impossible; no more succeeding lines>");
						return {"statement":"\n=======================\nRecovery impossible; Failed to compile.\n", "code":2}	
					}

					lex = lexemes[i];
					continue;
				}

				//newline adds the linecounter
				if(lex.type == "\\n"){
					linecounter++;
					temtok = lex.type;
				}

				print("Skipping unexpected token " + temtok + "")
				if(!first)
					errors.push("\tSub-error on line "+linecounter+". Unexpected token \""+temtok+"\" of type \"" + lex.type + "\"");
				
				i++;
				if(i == lexemes.length){
					print("<ERROR::Recovery impossible; no more succeeding lines>");
					return {"statement":"\n=======================\nRecovery impossible; Failed to compile.\n", "code":2}	
				}
				lex = lexemes[i];

				if(first)
					first = false;

			}

			continue;

		}

		print("[Parse Tree]------------")
		print(pStart.getText(0))
			
	}

	//Close the final node with epsilon
	var final = lastnode.parent.parent;
	final = final.children[final.children.length-1];
	final.value = "epsilon";
	final.finished = true;

	//print the final parse tree regardless of verbose flag
	console.log("========================")
	console.log("Final Parse Tree")
	console.log("========================")
	console.log(pStart.getText(0))
	
	if(errors.length > 0)
		return {"statement":"\n=======================\nCompilation successful with "+errors.length+" syntax error(s).\n", "code":1}
		
	return {"statement":"\n=======================\nCompilation successful with no syntax errors.\n", "code":1}
	
}

//The main program after compiling using lex.js
function start(file){
		
	print(lexemes)

	var result = check(lexemes)

	console.log(result["statement"])
	for (var i = 0; i < errors.length; i++) {
		console.log(errors[i]);
	}
	
	// pStart.save3(file);
	pStart.saveA(file);

	//Return parse tree sequence
	return "{\""+pStart.rule.root+"\":{\n"+pStart.getArray(1)+"}}";
	
}

function SyntaxAnalyze(tree){

	var obj = JSON.parse(tree);



}

//---]

function standalone(){
	compile();
	main(process.argv[2]);
	
}

exports.startSyn = function(file){
	compile();
	main(file);
	
}
exports.checkStart = function(){return finished}
exports.getSeq = function(){return out}