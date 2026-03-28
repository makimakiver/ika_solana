use futures_util::StreamExt;
use solana_client::{
    nonblocking::{pubsub_client::PubsubClient, rpc_client::RpcClient},
    rpc_config::{RpcTransactionLogsConfig, RpcTransactionLogsFilter},
};
use solana_sdk::{
    commitment_config::CommitmentConfig,
    instruction::{AccountMeta, Instruction},
    pubkey::Pubkey,
    signature::Keypair,
    signer::Signer,
    transaction::Transaction,
};
use std::{env, str::FromStr};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    dotenv::from_path(".env").ok();

    let wss_url = env::var("SOLANA_WSS_URL")?; // e.g. wss://mainnet.helius-rpc.com/?api-key=xxx
    let helius_rpc = env::var("HELIUS_RPC_URL")?; // e.g. https://mainnet.helius-rpc.com/?api-key=xxx

    let watched_program = env::var("WATCHED_PROGRAM")?;
    let reactor_program = Pubkey::from_str(&env::var("WATCHED_PROGRAM")?)?;
    let keypair = [
        237, 101, 204, 165, 242, 61, 127, 217, 119, 236, 233, 53, 157, 207, 120, 29, 48, 214, 104,
        226, 48, 229, 242, 215, 199, 142, 88, 172, 59, 172, 42, 184, 230, 212, 24, 175, 247, 26,
        209, 121, 236, 116, 49, 34, 167, 138, 165, 184, 50, 120, 218, 101, 203, 49, 62, 125, 147,
        60, 210, 146, 170, 244, 16, 44,
    ];
    // Your signer keypair
    let payer = Keypair::from_bytes(&keypair)?;

    // RPC client for sending transactions
    let rpc = RpcClient::new_with_commitment(helius_rpc, CommitmentConfig::confirmed());

    // --- WSS: subscribe to logs mentioning the watched program ---
    let pubsub = PubsubClient::new(&wss_url).await?;

    let (mut stream, _unsubscribe) = pubsub
        .logs_subscribe(
            RpcTransactionLogsFilter::Mentions(vec![watched_program.to_string()]),
            RpcTransactionLogsConfig {
                commitment: Some(CommitmentConfig::confirmed()),
            },
        )
        .await?;

    println!("Subscribed via WSS to program: {}", watched_program);

    // --- Process each matching transaction ---
    while let Some(log_response) = stream.next().await {
        let sig = &log_response.value.signature;
        println!("Detected tx: {}", sig);

        // Skip failed transactions
        if log_response.value.err.is_some() {
            continue;
        }

        // log_response.value.logs contains the raw program logs
        // TODO: parse event data from logs here, e.g.:
        // let event_data = parse_my_event(&log_response.value.logs);

        match react_to_event(&rpc, &payer, &reactor_program).await {
            Ok(reactor_sig) => println!("Reactor tx sent: {}", reactor_sig),
            Err(e) => eprintln!("Failed to send reactor tx: {}", e),
        }
    }

    Ok(())
}

async fn react_to_event(
    rpc: &RpcClient,
    payer: &Keypair,
    reactor_program: &Pubkey,
) -> Result<String, Box<dyn std::error::Error>> {
    // Build whatever instruction your "reactor" program expects
    let instruction = Instruction {
        program_id: *reactor_program,
        accounts: vec![
            AccountMeta::new(payer.pubkey(), true),
            // ... other accounts your program needs
        ],
        data: vec![/* your serialized instruction data */],
    };

    let recent_blockhash = rpc.get_latest_blockhash().await?;
    let tx = Transaction::new_signed_with_payer(
        &[instruction],
        Some(&payer.pubkey()),
        &[payer],
        recent_blockhash,
    );

    let sig = rpc.send_and_confirm_transaction(&tx).await?;
    Ok(sig.to_string())
}
