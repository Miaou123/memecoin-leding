import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { MemecoinLending } from "./target/types/memecoin_lending";

const program = anchor.workspace.MemecoinLending as Program<MemecoinLending>;

// Check what accounts createLoan expects
const createLoanAccounts = program.methods.createLoan(
  new anchor.BN(1000),
  new anchor.BN(86400),
  1000
).accounts({});

console.log("CreateLoan accounts structure:");
console.log(createLoanAccounts);

// Check IDL
const idl = program.idl;
const createLoanInstruction = idl.instructions.find((ix: any) => ix.name === "createLoan");
console.log("\nCreateLoan accounts from IDL:");
console.log(createLoanInstruction?.accounts.map((acc: any) => acc.name));