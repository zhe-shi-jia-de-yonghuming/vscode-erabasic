import * as vscode from "vscode";

type IndentNumber = -2 | -1 | 0 | 1 | 2;

enum BlockType {
  IF, //			IF ELSEIF ELSE IFEND
  SELECTCASE, //	SELECTCASE CASE ENDSELECT
  PRINTDATA, //		PRINTDATA DATA(FORM)? ENDDATA
  DATALIST, //		DATALIST DATA(FORM)？ ENDLIST
  FOR, //			FOR NEXT
  WHILE, // 		WHILE WEND
  REPEAT, // 		REPEAT REND
  TRYC, // 			TRYC(CALL|GOTO|JUMP)(FORM)? CATCH ENDCATCH
  TRYLIST, // 		TRY(CALL|GOTO|JUMP)LIST FUNC ENDFUNC
  LOOP, // 			DO LOOP
  CONNECT, // 		{}
  SIF, //			SIF
  SKIP, //			[SKIPSTART] [SKIPEND]
  NONE,
}

type IndenterBlock = {
  type: BlockType;
  controlRange: vscode.Range;
};

type IndenterError = {
  hasError: boolean;
  diagnostic: vscode.Diagnostic;
};

const stmIF = /^\s*\bIF\b/;
const stmELSE = /^\s*\b(ELSEIF|ELSE)\b/;
const stmENDIF = /^\s*\bENDIF\b/;

const stmSELECTCASE = /^\s*\bSELECTCASE\b/;
const stmCASE = /^\s*\bCASE(ELSE)?\b/;
const stmENDSELECT = /^\s*\bENDSELECT\b/;

const stmPRINTDATA = /^\s*\bPRINTDATA\b/;
const stmENDDATA = /^\s*\bENDDATA\b/;

const stmDATALIST = /^\s*\bDATALIST\b/;
const stmDATA = /^\s*\bDATA(FORM)?\b/;
const stmENDLIST = /^\s*\bENDLIST\b/;

const stmFOR = /^\s*\bFOR\b/;
const stmNEXT = /^\s*\bNEXT\b/;

const stmWHILE = /^\s*\bWHILE\b/;
const stmWEND = /^\s*\bWEND\b/;

const stmREPEAT = /^\s*\bREPEAT\b/;
const stmREND = /^\s*\bREND\b/;

const stmTRYC = /^\s*\bTRYC(CALL|JUMP|GOTO)(FORM)?\b/;
const stmCATCH = /^\s*\bCATCH\b/;
const stmENDCATCH = /^\s*\bENDCATCH\b/;

const stmTRYLIST = /^\s*\bTRY(CALL|JUMP|GOTO)LIST\b/;
const stmFUNC = /^\s*\bFUNC\b/;
const stmENDFUNC = /^\s*\bENDFUNC\b/;

const stmDO = /^\s*\bDO\b/;
const stmLOOP = /^\s*\bLOOP\b/;

const stmConnect = /^\s*{\s*$/;
const stmEndConnect = /^\s*}\s*$/;

const stmSkipStart = /^\s*\[SKIPSTART\]/;
const stmSkipEnd = /^\s*\[SKIPEND\]/;

const defFunction = /^\s*@/;
const stmSIF = /^\s*\bSIF\b/;
const stmComment = /;\S*/;

class IndenterBlockCollection {
  private blocks: IndenterBlock[];

  public constructor(blocks: IndenterBlock[] = []) {
    this.blocks = blocks;
  }

  public get length(): number {
    return this.blocks.length;
  }

  public checkStackTop(type: BlockType): boolean {
    if (this.blocks.length <= 0) {
      return false;
    }
    return this.blocks[this.blocks.length - 1].type === type;
  }

  public push(type: BlockType, textLine: vscode.TextLine, regex: RegExp) {
    // var result: RegExpExecArray = regex.test(textLine.text);
    // if (result !== null) {
    //   this.blocks.push({ type: type, controlRange: result.groups[0]});
    // }
    var result: RegExpExecArray = regex.exec(textLine.text);
    this.blocks.push({
      type: type,
      controlRange: new vscode.Range(
        textLine.lineNumber,
        result.index,
        textLine.lineNumber,
        result.index + result[0].length
      ),
    });
  }

  public pop(
    endBlockType: BlockType,
    textLine: vscode.TextLine
  ): vscode.Diagnostic | null {
    if (this.blocks.length <= 0) {
      return null;
    }
    var last_block = this.blocks[this.blocks.length - 1];
    if (last_block.type !== endBlockType) {
      if (this.blocks.length >= 2) {
        // if the outer layer block match with the end block
        // we can assume this block missing an end block identifier
        var prev_block = this.blocks[this.blocks.length - 2];
        if (prev_block.type === endBlockType) {
          this.blocks.pop();
          return new vscode.Diagnostic(
            last_block.controlRange,
            `Missing end for block ${BlockType[last_block.type]}.`
          );
        }
      }
      // otherwise there might be redundant end block identifier
      // better not pop the block out
      return new vscode.Diagnostic(
        textLine.range,
        `Unpaired end for block ${BlockType[endBlockType]}.`
      );
    } else {
      this.blocks.pop();
      return null;
    }
  }

  public clear() {
    this.blocks = [];
  }
}

export class EraBasicIndenter {
  public error: IndenterError = {
    hasError: false,
    diagnostic: null,
  };

  private nextState: IndentNumber = 0;

  private currentState: IndentNumber = 0;

  private blockStack: IndenterBlockCollection = new IndenterBlockCollection();

  private currentIndent: number = 0;

  constructor(
    private readonly config: vscode.WorkspaceConfiguration,
    private options: vscode.FormattingOptions | null
  ) {}

  public updateOptions(options: vscode.FormattingOptions) {
    this.options = options;
  }

  public reset() {
    this.blockStack.clear();
    this.nextState = 0;
    this.currentState = 0;
    this.currentIndent = 0;
    this.error.hasError = false;
    this.error.diagnostic = null;
  }

  public resolve(textLine: vscode.TextLine) {
    let text: string = textLine.text;
    let diag = undefined;

    if (stmSkipStart.test(text)) {
      this.blockStack.push(BlockType.SKIP, textLine, stmSkipStart);
    } else if (stmSkipEnd.test(text)) {
      diag = this.blockStack.pop(BlockType.SKIP, textLine);
    }

    // connection syntax
    // indent not needed
    if (stmConnect.test(text)) {
      this.nextState = 1;
      this.blockStack.push(BlockType.CONNECT, textLine, stmConnect);
    } else if (stmEndConnect.test(text)) {
      this.currentState = -1;
      diag = this.blockStack.pop(BlockType.CONNECT, textLine);
    }

    // SIF syntax only indent forward for 1 line
    if (
      this.blockStack.length > 0 &&
      this.blockStack.checkStackTop(BlockType.SIF)
    ) {
      this.nextState = -1;
      diag = this.blockStack.pop(BlockType.SIF, textLine);
      return;
    }

    if (
      this.blockStack.length > 0 &&
      this.blockStack.checkStackTop(BlockType.CONNECT)
    ) {
      return; // do nothing
    }

    let comment = stmComment.exec(text);

    if (comment != null) {
      text = text.substring(0, comment.index);
    }

    if (stmIF.test(text)) {
      this.nextState = 1;
      this.blockStack.push(BlockType.IF, textLine, stmIF);
    } else if (stmELSE.test(text)) {
      this.currentState = -1;
      this.nextState = 1;
    } else if (stmENDIF.test(text)) {
      this.currentState = -1;
      diag = this.blockStack.pop(BlockType.IF, textLine);
    } else if (stmSELECTCASE.test(text)) {
      this.nextState = 2;
      this.blockStack.push(BlockType.SELECTCASE, textLine, stmSELECTCASE);
    } else if (stmCASE.test(text)) {
      this.currentState = -1;
      this.nextState = 1;
    } else if (stmENDSELECT.test(text)) {
      this.currentState = -2;
      diag = this.blockStack.pop(BlockType.SELECTCASE, textLine);
    } else if (stmFOR.test(text)) {
      this.nextState = 1;
      this.blockStack.push(BlockType.FOR, textLine, stmFOR);
    } else if (stmNEXT.test(text)) {
      this.currentState = -1;
      diag = this.blockStack.pop(BlockType.FOR, textLine);
    } else if (stmWHILE.test(text)) {
      this.nextState = 1;
      this.blockStack.push(BlockType.WHILE, textLine, stmWHILE);
    } else if (stmWEND.test(text)) {
      this.currentState = -1;
      diag = this.blockStack.pop(BlockType.WHILE, textLine);
    } else if (stmDO.test(text)) {
      this.nextState = 1;
      this.blockStack.push(BlockType.LOOP, textLine, stmDO);
    } else if (stmLOOP.test(text)) {
      this.currentState = -1;
      diag = this.blockStack.pop(BlockType.LOOP, textLine);
    } else if (stmREPEAT.test(text)) {
      this.nextState = 1;
      this.blockStack.push(BlockType.REPEAT, textLine, stmREPEAT);
    } else if (stmREND.test(text)) {
      this.currentState = -1;
      this.blockStack.pop(BlockType.REPEAT, textLine);
    } else if (stmTRYC.test(text)) {
      this.nextState = 1;
      this.blockStack.push(BlockType.TRYC, textLine, stmTRYC);
    } else if (stmCATCH.test(text)) {
      this.currentState = -1;
      this.nextState = 1;
    } else if (stmENDCATCH.test(text)) {
      this.currentState = -1;
      diag = this.blockStack.pop(BlockType.TRYC, textLine);
    } else if (stmTRYLIST.test(text)) {
      this.nextState = 1;
      this.blockStack.push(BlockType.TRYLIST, textLine, stmTRYLIST);
    } else if (stmENDFUNC.test(text)) {
      this.currentState = -1;
      diag = this.blockStack.pop(BlockType.TRYLIST, textLine);
    } else if (stmPRINTDATA.test(text)) {
      this.nextState = 1;
      this.blockStack.push(BlockType.PRINTDATA, textLine, stmPRINTDATA);
    } else if (stmDATALIST.test(text)) {
      this.nextState = 1;
      this.blockStack.push(BlockType.DATALIST, textLine, stmDATALIST);
    } else if (stmENDLIST.test(text)) {
      this.currentState = -1;
      diag = this.blockStack.pop(BlockType.DATALIST, textLine);
    } else if (stmENDDATA.test(text)) {
      this.currentState = -1;
      diag = this.blockStack.pop(BlockType.PRINTDATA, textLine);
    } else if (stmSIF.test(text)) {
      this.nextState = 1;
      this.blockStack.push(BlockType.SIF, textLine, stmSIF);
    } else if (defFunction.test(text)) {
      if (this.config.get("functionIndent")) {
        this.currentState = -1;
        this.nextState = 1;
      }
    }

    if (diag !== undefined) {
      this.error.hasError = true;
      this.error.diagnostic = diag;
    }
  }

  public updateCurrent() {
    this.currentIndent += this.currentState;
    this.currentIndent = Math.max(this.currentIndent, 0);

    this.currentState = 0;
  }

  public updateNext() {
    this.currentIndent += this.nextState;
    this.currentIndent = Math.max(this.currentIndent, 0);

    this.nextState = 0;
  }

  public setIndent(text: string): string {
    let result = text.trimStart();

    if (result.length === 0) {
      return result;
    }

    return (
      (this.options.insertSpaces
        ? " ".repeat(this.options.tabSize)
        : "\t"
      ).repeat(this.currentIndent) + result
    );
  }
}
