// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20 {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function approve(address spender, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

interface IFeeAssetHandler {
    function mint(address _recipient) external;
    function mintAmount() external view returns (uint256);
}

interface IFeeJuicePortal {
    function depositToAztecPublic(
        bytes32 _to,
        uint256 _amount,
        bytes32 _secretHash
    ) external returns (bytes32, uint256);
}

/**
 * @title GregoJuiceBridge
 * @notice Atomic double-bridge: deposits fee juice to two Aztec recipients in a single L1 tx.
 *         Designed for the flow where a user needs to fund an ephemeral claimer account (small
 *         amount for gas) AND a target recipient (main amount) in one shot.
 *
 *         On testnet with a faucet, the contract can mint tokens directly.
 *         On mainnet, the user transfers tokens to this contract beforehand (via approve + call).
 */
contract GregoJuiceBridge {
    /**
     * @notice Mint from faucet and bridge to two recipients atomically.
     *         The faucet mints a fixed amount per call, so we mint twice and split.
     * @param feeAssetHandler  Address of the fee asset handler (faucet)
     * @param feeJuice         Address of the fee juice ERC20 token
     * @param portal           Address of the FeeJuicePortal
     * @param toSmall          Aztec address of the ephemeral claimer account
     * @param amountSmall      Amount for the ephemeral account (gas money)
     * @param secretHashSmall  Secret hash for the small claim
     * @param toLarge          Aztec address of the target recipient
     * @param amountLarge      Amount for the target recipient
     * @param secretHashLarge  Secret hash for the large claim
     */
    function mintAndBridgeDouble(
        address feeAssetHandler,
        address feeJuice,
        address portal,
        bytes32 toSmall,
        uint256 amountSmall,
        bytes32 secretHashSmall,
        bytes32 toLarge,
        uint256 amountLarge,
        bytes32 secretHashLarge
    ) external {
        uint256 totalNeeded = amountSmall + amountLarge;

        // Mint from faucet — may need multiple calls since mint() gives a fixed amount
        uint256 mintAmt = IFeeAssetHandler(feeAssetHandler).mintAmount();
        uint256 mintsNeeded = (totalNeeded + mintAmt - 1) / mintAmt;
        for (uint256 i = 0; i < mintsNeeded; i++) {
            IFeeAssetHandler(feeAssetHandler).mint(address(this));
        }

        // Approve portal for total amount
        IERC20(feeJuice).approve(portal, totalNeeded);

        // Two deposits in one tx
        IFeeJuicePortal(portal).depositToAztecPublic(toSmall, amountSmall, secretHashSmall);
        IFeeJuicePortal(portal).depositToAztecPublic(toLarge, amountLarge, secretHashLarge);
    }

    /**
     * @notice Bridge tokens (already held by the user) to two recipients atomically.
     *         The user must approve this contract for `amountSmall + amountLarge` first.
     * @param feeJuice    Address of the fee juice ERC20 token
     * @param portal      Address of the FeeJuicePortal
     * @param toSmall     Aztec address of the ephemeral claimer account
     * @param amountSmall Amount for the ephemeral account
     * @param secretHashSmall  Secret hash for the small claim
     * @param toLarge     Aztec address of the target recipient
     * @param amountLarge Amount for the target recipient
     * @param secretHashLarge  Secret hash for the large claim
     */
    function bridgeDouble(
        address feeJuice,
        address portal,
        bytes32 toSmall,
        uint256 amountSmall,
        bytes32 secretHashSmall,
        bytes32 toLarge,
        uint256 amountLarge,
        bytes32 secretHashLarge
    ) external {
        uint256 totalAmount = amountSmall + amountLarge;

        // Pull tokens from sender
        IERC20(feeJuice).transferFrom(msg.sender, address(this), totalAmount);

        // Approve portal
        IERC20(feeJuice).approve(portal, totalAmount);

        // Two deposits in one tx
        IFeeJuicePortal(portal).depositToAztecPublic(toSmall, amountSmall, secretHashSmall);
        IFeeJuicePortal(portal).depositToAztecPublic(toLarge, amountLarge, secretHashLarge);
    }

    /**
     * @notice Single bridge convenience — mint from faucet and bridge to one recipient.
     * @param feeAssetHandler  Address of the fee asset handler (faucet)
     * @param feeJuice         Address of the fee juice ERC20 token
     * @param portal           Address of the FeeJuicePortal
     * @param to               Aztec address of the recipient
     * @param amount           Amount to bridge
     * @param secretHash       Secret hash for the claim
     */
    function mintAndBridge(
        address feeAssetHandler,
        address feeJuice,
        address portal,
        bytes32 to,
        uint256 amount,
        bytes32 secretHash
    ) external {
        uint256 mintAmt = IFeeAssetHandler(feeAssetHandler).mintAmount();
        uint256 mintsNeeded = (amount + mintAmt - 1) / mintAmt;
        for (uint256 i = 0; i < mintsNeeded; i++) {
            IFeeAssetHandler(feeAssetHandler).mint(address(this));
        }

        IERC20(feeJuice).approve(portal, amount);
        IFeeJuicePortal(portal).depositToAztecPublic(to, amount, secretHash);
    }

    /**
     * @notice Single bridge convenience — user transfers tokens and bridges to one recipient.
     * @param feeJuice   Address of the fee juice ERC20 token
     * @param portal     Address of the FeeJuicePortal
     * @param to         Aztec address of the recipient
     * @param amount     Amount to bridge
     * @param secretHash Secret hash for the claim
     */
    function bridge(
        address feeJuice,
        address portal,
        bytes32 to,
        uint256 amount,
        bytes32 secretHash
    ) external {
        IERC20(feeJuice).transferFrom(msg.sender, address(this), amount);
        IERC20(feeJuice).approve(portal, amount);
        IFeeJuicePortal(portal).depositToAztecPublic(to, amount, secretHash);
    }
}
