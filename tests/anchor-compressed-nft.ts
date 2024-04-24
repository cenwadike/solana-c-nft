import * as anchor from "@project-serum/anchor"
import { AnchorCompressedNft } from "../target/types/anchor_compressed_nft"
import { Program } from "@project-serum/anchor"
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  clusterApiUrl,
  sendAndConfirmTransaction,
} from "@solana/web3.js"
import {
  SPL_ACCOUNT_COMPRESSION_PROGRAM_ID,
  SPL_NOOP_PROGRAM_ID,
  ValidDepthSizePair,
  createAllocTreeIx,
  ConcurrentMerkleTreeAccount
} from "@solana/spl-account-compression"
import { assert } from "chai"
import { PROGRAM_ID as MPL_BUBBLEGUM_PROGRAM_ID } from "@metaplex-foundation/mpl-bubblegum"
import {
  Metaplex,
  keypairIdentity,
  CreateNftOutput,
} from "@metaplex-foundation/js"
import { PROGRAM_ID as TOKEN_METADATA_PROGRAM_ID } from "@metaplex-foundation/mpl-token-metadata"

describe("anchor-compressed-nft", () => {
  const provider = anchor.AnchorProvider.env()
  anchor.setProvider(provider)
  const wallet = provider.wallet as anchor.Wallet
  const program = anchor.workspace
    .AnchorCompressedNft as Program<AnchorCompressedNft>

  // const connection = program.provider.connection
  const connection = new Connection(clusterApiUrl("devnet"), "confirmed")

  const metaplex = Metaplex.make(connection).use(keypairIdentity(wallet.payer))

  // keypair for tree
  const merkleTree = Keypair.generate()

  // tree authority
  const [treeAuthority] = PublicKey.findProgramAddressSync(
    [merkleTree.publicKey.toBuffer()],
    MPL_BUBBLEGUM_PROGRAM_ID
  )

  // pda "tree creator", allows our program to update the tree
  const [pda] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("AUTH")],
    program.programId
  )

  const [bubblegumSigner] = PublicKey.findProgramAddressSync(
    [Buffer.from("collection_cpi", "utf8")],
    MPL_BUBBLEGUM_PROGRAM_ID
  )

  const maxDepthSizePair: ValidDepthSizePair = {
    maxDepth: 14,
    maxBufferSize: 64,
  }
  const canopyDepth = maxDepthSizePair.maxDepth - 5

  const metadata = {
    uri: "https://raw.githubusercontent.com/687c/solana-nft-native-client/main/metadata.json",
    name: "Kombi",
    symbol: "KMB",
  }

  let collectionNft: CreateNftOutput

  before(async () => {
    // Create collection nft
    collectionNft = await metaplex.nfts().create({
      uri: metadata.uri,
      name: metadata.name,
      sellerFeeBasisPoints: 0,
      isCollection: true,
    })

    // transfer collection nft metadata update authority to pda
    await metaplex.nfts().update({
      nftOrSft: collectionNft.nft,
      updateAuthority: wallet.payer,
      newUpdateAuthority: pda,
    })

    // instruction to create new account with required space for tree
    const allocTreeIx = await createAllocTreeIx(
      connection,
      merkleTree.publicKey,
      wallet.publicKey,
      maxDepthSizePair,
      canopyDepth
    )

    const tx = new Transaction().add(allocTreeIx)

    const txSignature = await sendAndConfirmTransaction(
      connection,
      tx,
      [wallet.payer, merkleTree],
      {
        commitment: "confirmed",
      }
    )
    console.log(`https://explorer.solana.com/tx/${txSignature}?cluster=devnet`)
  })

  it("Create Tree", async () => {
    // create tree via CPI
    try {
      const txSignature = await program.methods
        .anchorCreateTree(
          maxDepthSizePair.maxDepth,
          maxDepthSizePair.maxBufferSize
        )
        .accounts({
          pda: pda,
          merkleTree: merkleTree.publicKey,
          treeAuthority: treeAuthority,
          logWrapper: SPL_NOOP_PROGRAM_ID,
          bubblegumProgram: MPL_BUBBLEGUM_PROGRAM_ID,
          compressionProgram: SPL_ACCOUNT_COMPRESSION_PROGRAM_ID,
        })
        .rpc({ commitment: "confirmed" })
      console.log(`https://explorer.solana.com/tx/${txSignature}?cluster=devnet`)
    } catch (error) {
      console.log(error)
    }
    // fetch tree account
    const treeAccount = await ConcurrentMerkleTreeAccount.fromAccountAddress(
      connection,
      merkleTree.publicKey
    )

    console.log("MaxBufferSize", treeAccount.getMaxBufferSize())
    console.log("MaxDepth", treeAccount.getMaxDepth())
    console.log("Tree Authority", treeAccount.getAuthority().toString())

    assert.strictEqual(
      treeAccount.getMaxBufferSize(),
      maxDepthSizePair.maxBufferSize
    )
    assert.strictEqual(treeAccount.getMaxDepth(), maxDepthSizePair.maxDepth)
    assert.isTrue(treeAccount.getAuthority().equals(treeAuthority))
  })

  it("Mint Compressed NFT", async () => {
    // mint compressed nft 
    try {
      const txSignature = await program.methods
        .mintCompressedNft()
        .accounts({
          pda: pda,
          merkleTree: merkleTree.publicKey,
          treeAuthority: treeAuthority,
          logWrapper: SPL_NOOP_PROGRAM_ID,
          bubblegumSigner: bubblegumSigner,
          bubblegumProgram: MPL_BUBBLEGUM_PROGRAM_ID,
          compressionProgram: SPL_ACCOUNT_COMPRESSION_PROGRAM_ID,
          tokenMetadataProgram: TOKEN_METADATA_PROGRAM_ID,

          collectionMint: collectionNft.mintAddress,
          collectionMetadata: collectionNft.metadataAddress,
          editionAccount: collectionNft.masterEditionAddress,
        })
        .rpc({ commitment: "confirmed" })
      console.log(`https://explorer.solana.com/tx/${txSignature}?cluster=devnet`)
    } catch (error) {
      console.log(error)
    }
  })
})
