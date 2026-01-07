const anchor = require("@coral-xyz/anchor");
const { PublicKey, Keypair, SystemProgram } = require("@solana/web3.js");

async function main() {
  // Configure provider
  const provider = anchor.AnchorProvider.local();
  anchor.setProvider(provider);
  
  // Load program
  const idl = require("./target/idl/memecoin_lending.json");
  const programId = new PublicKey("Ex1UJrdAUqosatT1moQSPTMepfKtnKWKfsKMTjZBeKva");
  const program = new anchor.Program(idl, programId, provider);
  
  // Test accounts
  const admin = Keypair.generate();
  const buybackWallet = Keypair.generate();
  const operationsWallet = Keypair.generate();
  const liquidator = Keypair.generate();
  
  // Airdrop
  console.log("Airdropping SOL...");
  const sig = await provider.connection.requestAirdrop(
    admin.publicKey,
    10 * anchor.web3.LAMPORTS_PER_SOL
  );
  await provider.connection.confirmTransaction(sig);
  
  // Derive PDAs
  const [protocolStatePda] = PublicKey.findProgramAddressSync(
    [Buffer.from("protocol_state")],
    program.programId
  );
  
  const [treasuryPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("treasury")],
    program.programId
  );
  
  console.log("Protocol State PDA:", protocolStatePda.toString());
  console.log("Treasury PDA:", treasuryPda.toString());
  
  // Initialize
  try {
    console.log("\nCalling initialize...");
    const tx = await program.methods
      .initialize(
        admin.publicKey,
        buybackWallet.publicKey,
        operationsWallet.publicKey,
        liquidator.publicKey,
        admin.publicKey // price_authority
      )
      .accountsStrict({
        protocolState: protocolStatePda,
        treasury: treasuryPda,
        payer: admin.publicKey,
        systemProgram: SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .signers([admin])
      .rpc();
      
    console.log("✅ Initialize successful! TX:", tx);
    
    // Fetch and verify
    const protocolState = await program.account.protocolState.fetch(protocolStatePda);
    console.log("\nProtocol State:");
    console.log("- Admin:", protocolState.admin.toString());
    console.log("- Buyback Wallet:", protocolState.buybackWallet.toString());
    console.log("- Operations Wallet:", protocolState.operationsWallet.toString());
    console.log("- Paused:", protocolState.paused);
    console.log("- Protocol Fee BPS:", protocolState.protocolFeeBps);
    
  } catch (error) {
    console.error("❌ Initialize failed:", error.message);
    if (error.logs) {
      console.log("\nLogs:");
      error.logs.forEach(log => console.log(log));
    }
  }
}

main().catch(console.error);