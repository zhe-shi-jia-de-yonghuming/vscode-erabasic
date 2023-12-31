import * as vscode from "vscode";

type IndentNumber = -2 | -1 | 0 | 1 | 2;

export enum BlockType {
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

const stmIF = /\bIF\b/;
const stmELSE = /\b(ELSEIF|ELSE)\b/;
const stmENDIF = /\bENDIF\b/;

const stmSELECTCASE = /\bSELECTCASE\b/;
const stmCASE = /\bCASE(ELSE)?\b/;
const stmENDSELECT = /\bENDSELECT\b/;

const stmPRINTDATA = /\bPRINTDATA\b/;
const stmENDDATA = /\bENDDATA\b/;

const stmDATALIST = /\bDATALIST\b/;
const stmDATA = /\bDATA(FORM)?\b/;
const stmENDLIST = /\bENDLIST\b/;

const stmFOR = /\bFOR\b/;
const stmNEXT = /\bNEXT\b/;

const stmWHILE = /\bWHILE\b/;
const stmWEND = /\bWEND\b/;

const stmREPEAT = /\bREPEAT\b/;
const stmREND = /\bREND\b/;

const stmTRYC = /\bTRYC(CALL|JUMP|GOTO)(FORM)?\b/;
const stmCATCH = /\bCATCH\b/;
const stmENDCATCH = /\bENDCATCH\b/;

const stmTRYLIST = /\bTRY(CALL|JUMP|GOTO)LIST\b/;
const stmFUNC = /\bFUNC\b/;
const stmENDFUNC = /\bENDFUNC\b/;

const stmDO = /\bDO\b/;
const stmLOOP = /\bLOOP\b/;

const stmConnect = /^\s*({)\s*$/;
const stmEndConnect = /^\s*(})\s*$/;

const stmSkipStart = /\[SKIPSTART\]/;
const stmSkipEnd = /\[SKIPEND\]/;

const defFunction = /^\s*@/;
const stmSIF = /\bSIF\b/;
const stmComment = /;\S*/;

class IndenterBlockCollection {
  private blocks: IndenterBlock[];

  private currentDiags: vscode.Diagnostic[] = [];

  public constructor(blocks: IndenterBlock[] = []) {
    this.blocks = blocks;
  }

  public get length(): number {
    return this.blocks.length;
  }

  public get error(): vscode.Diagnostic[] {
    return this.currentDiags;
  }

  public getByIndex(index: number): IndenterBlock | null {
    if (index < 0 || index >= this.blocks.length) {
      return null;
    }
    return this.blocks[index];
  }

  public checkStackTop(type: BlockType): boolean {
    if (this.blocks.length <= 0) {
      return false;
    }
    return this.blocks[this.blocks.length - 1].type === type;
  }

  /**
   * Pushes a new block to the blocks array based on the given type, textLine, and regex.
   *
   * @param {BlockType} type - the type of the block
   * @param {vscode.TextLine} textLine - the text line to search for matches
   * @param {RegExp} regex - the regular expression to match against the text line
   */
  public push(type: BlockType, textLine: vscode.TextLine, regex: RegExp) {
    const result: RegExpExecArray = regex.exec(textLine.text);
    if (result) {
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
  }

  /**
   * Pop a block from the stack and check if it matches the given end block type.
   *
   * @param {BlockType} endBlockType - The type of the end block to match.
   * @param {vscode.TextLine} textLine - The text line containing the block.
   * @param {RegExp} regex - The regular expression to match the block.
   * @return {vscode.Diagnostic | null} - The diagnostic if there is an error, otherwise null.
   */
  public pop(
    endBlockType: BlockType,
    textLine: vscode.TextLine,
    regex: RegExp | null = null
  ): vscode.Diagnostic | null {
    // special case for SIF
    if (!regex) {
      this.blocks.pop();
      return;
    }

    const result = regex.exec(textLine.text);

    const range = new vscode.Range(
      textLine.lineNumber,
      result.index,
      textLine.lineNumber,
      result.index + result[0].length
    );

    if (this.blocks.length <= 0) {
      this.addIndentDiagnostics(
        range,
        vscode.l10n.t("Missing start identifier for block {0}", {
          0: BlockType[endBlockType],
        })
      );
      return;
    }

    const lastBlock = this.blocks[this.blocks.length - 1];

    // if block type matches, juse pop the block
    if (lastBlock.type === endBlockType) {
      this.blocks.pop();
      return;
    }

    // if the second last block type matches
    // we assume that the last block missed an end identifier
    // and we can pop both block
    if (
      this.blocks.length >= 2 &&
      this.blocks[this.blocks.length - 2].type === endBlockType
    ) {
      this.blocks.pop();
      this.blocks.pop();
    } else {
      // otherwise we just assume the end identifier is unrelated
      // and we can pop the last block
      this.blocks.pop();
    }
    this.addIndentDiagnostics(
      lastBlock.controlRange,
      vscode.l10n.t("Missing end identifier for block {0}", {
        0: BlockType[lastBlock.type],
      })
    );
  }

  public clear() {
    if (this.blocks.length <= 0) {
      return null;
    }
    for (let i = 0; i < this.blocks.length; i++) {
      const block = this.blocks[i];
      this.addIndentDiagnostics(
        block.controlRange,
        vscode.l10n.t("Missing end identifier for block {0}", {
          0: BlockType[block.type],
        })
      );
    }
    this.blocks = [];
  }

  private addIndentDiagnostics(range: vscode.Range, message: string) {
    const diagnostic = new vscode.Diagnostic(range, message);
    this.currentDiags.push(diagnostic);
  }
}

export class EraBasicIndenter {
  private nextState: IndentNumber = 0;

  private currentState: IndentNumber = 0;

  private blockStack: IndenterBlockCollection = new IndenterBlockCollection();

  private currentIndent = 0;

  private extensionConfig = vscode.workspace.getConfiguration("erabasic");

  constructor(private options: vscode.FormattingOptions | null) {}

  /**
   * Resolves the given text line.
   *
   * @param {vscode.TextLine} textLine - The text line to resolve.
   */
  public resolve(textLine: vscode.TextLine): boolean {
    let text: string = textLine.text;

    if (stmSkipStart.test(text)) {
      this.blockStack.push(BlockType.SKIP, textLine, stmSkipStart);
    } else if (stmSkipEnd.test(text)) {
      this.blockStack.pop(BlockType.SKIP, textLine, stmSkipEnd);
    }

    // connection syntax
    // indent not needed
    if (stmConnect.test(text)) {
      this.nextState = 1;
      this.blockStack.push(BlockType.CONNECT, textLine, stmConnect);
    } else if (stmEndConnect.test(text)) {
      this.currentState = -1;
      this.blockStack.pop(BlockType.CONNECT, textLine, stmEndConnect);
    }

    // SIF syntax only indent forward for 1 line
    if (
      this.blockStack.length > 0 &&
      this.blockStack.checkStackTop(BlockType.SIF)
    ) {
      this.nextState = -1;
      this.blockStack.pop(BlockType.SIF, textLine);
      return true;
    }

    if (
      this.blockStack.length > 0 &&
      this.blockStack.checkStackTop(BlockType.CONNECT)
    ) {
      return true; // do nothing
    }

    const comment = stmComment.exec(text);

    if (comment != null) {
      text = text.substring(0, comment.index);
      if (text.trim().length === 0)
        if (this.extensionConfig.get("commentIndent")) {
          return true;
        } else {
          return false;
        }
    }

    if (stmIF.test(text)) {
      this.nextState = 1;
      this.blockStack.push(BlockType.IF, textLine, stmIF);
    } else if (stmELSE.test(text)) {
      this.currentState = -1;
      this.nextState = 1;
    } else if (stmENDIF.test(text)) {
      this.currentState = -1;
      this.blockStack.pop(BlockType.IF, textLine, stmENDIF);
    } else if (stmSELECTCASE.test(text)) {
      this.nextState = 2;
      this.blockStack.push(BlockType.SELECTCASE, textLine, stmSELECTCASE);
    } else if (stmCASE.test(text)) {
      this.currentState = -1;
      this.nextState = 1;
    } else if (stmENDSELECT.test(text)) {
      this.currentState = -2;
      this.blockStack.pop(BlockType.SELECTCASE, textLine, stmENDSELECT);
    } else if (stmFOR.test(text)) {
      this.nextState = 1;
      this.blockStack.push(BlockType.FOR, textLine, stmFOR);
    } else if (stmNEXT.test(text)) {
      this.currentState = -1;
      this.blockStack.pop(BlockType.FOR, textLine, stmNEXT);
    } else if (stmWHILE.test(text)) {
      this.nextState = 1;
      this.blockStack.push(BlockType.WHILE, textLine, stmWHILE);
    } else if (stmWEND.test(text)) {
      this.currentState = -1;
      this.blockStack.pop(BlockType.WHILE, textLine, stmWEND);
    } else if (stmDO.test(text)) {
      this.nextState = 1;
      this.blockStack.push(BlockType.LOOP, textLine, stmDO);
    } else if (stmLOOP.test(text)) {
      this.currentState = -1;
      this.blockStack.pop(BlockType.LOOP, textLine, stmLOOP);
    } else if (stmREPEAT.test(text)) {
      this.nextState = 1;
      this.blockStack.push(BlockType.REPEAT, textLine, stmREPEAT);
    } else if (stmREND.test(text)) {
      this.currentState = -1;
      this.blockStack.pop(BlockType.REPEAT, textLine, stmREND);
    } else if (stmTRYC.test(text)) {
      this.nextState = 1;
      this.blockStack.push(BlockType.TRYC, textLine, stmTRYC);
    } else if (stmCATCH.test(text)) {
      this.currentState = -1;
      this.nextState = 1;
    } else if (stmENDCATCH.test(text)) {
      this.currentState = -1;
      this.blockStack.pop(BlockType.TRYC, textLine, stmENDCATCH);
    } else if (stmTRYLIST.test(text)) {
      this.nextState = 1;
      this.blockStack.push(BlockType.TRYLIST, textLine, stmTRYLIST);
    } else if (stmENDFUNC.test(text)) {
      this.currentState = -1;
      this.blockStack.pop(BlockType.TRYLIST, textLine, stmENDFUNC);
    } else if (stmPRINTDATA.test(text)) {
      this.nextState = 1;
      this.blockStack.push(BlockType.PRINTDATA, textLine, stmPRINTDATA);
    } else if (stmDATALIST.test(text)) {
      this.nextState = 1;
      this.blockStack.push(BlockType.DATALIST, textLine, stmDATALIST);
    } else if (stmENDLIST.test(text)) {
      this.currentState = -1;
      this.blockStack.pop(BlockType.DATALIST, textLine, stmENDLIST);
    } else if (stmENDDATA.test(text)) {
      this.currentState = -1;
      this.blockStack.pop(BlockType.PRINTDATA, textLine, stmENDDATA);
    } else if (stmSIF.test(text)) {
      this.nextState = 1;
      this.blockStack.push(BlockType.SIF, textLine, stmSIF);
    } else if (defFunction.test(text)) {
      this.currentIndent = 0;
      if (this.extensionConfig.get("functionIndent")) {
        this.nextState = 1;
      }
      this.blockStack.clear();
    }

    return true;
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

  /**
   * Sets the indent of the given text.
   *
   * @param {string} text - The text to set the indent for.
   * @return {string} The indented text.
   */
  public setIndent(text: string): string {
    const result = text.trimStart();

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

  public get blocks(): IndenterBlockCollection {
    return this.blockStack;
  }
}
