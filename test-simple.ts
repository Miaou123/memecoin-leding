import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey, Keypair, SystemProgram } from "@solana/web3.js";
import { MemecoinLending } from "./target/types/memecoin_lending";

describe("Simple test", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  
  const program = anchor.workspace.MemecoinLending as Program<MemecoinLending>;
  
  it("Initialize", async () => {
    const admin = Keypair.generate();
    const buybackWallet = Keypair.generate();
    const operationsWallet = Keypair.generate();
    const liquidator = Keypair.generate();
    
    // Airdrop SOL
    const sig = await provider.connection.requestAirdrop(
      admin.publicKey,
      anchor.web3.LAMPORTS_PER_SOL * 10
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
    
    // Initialize
    try {
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
        
      console.log("Initialize tx:", tx);
      console.log("✅ Initialize test passed!");
      
    } catch (error) {
      console.error("❌ Initialize test failed:", error);
      throw error;
    }
  });
});