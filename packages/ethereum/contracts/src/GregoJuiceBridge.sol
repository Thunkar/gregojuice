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
 * @notice Atomic multi-bridge: deposits fee juice to N Aztec recipients in a single L1 tx.
 *         Supports single and multiple recipient flows, with both faucet (testnet) and
 *         user-funded (mainnet) paths.
 */
contract GregoJuiceBridge {
    /**
     * @notice Mint from faucet and bridge to multiple recipients atomically.
     * @param feeAssetHandler  Address of the fee asset handler (faucet)
     * @param feeJuice         Address of the fee juice ERC20 token
     * @param portal           Address of the FeeJuicePortal
     * @param recipients       Aztec addresses of the recipients
     * @param amounts          Amounts for each recipient
     * @param secretHashes     Secret hashes for each claim
     */
    function mintAndBridgeMultiple(
        address feeAssetHandler,
        address feeJuice,
        address portal,
        bytes32[] calldata recipients,
        uint256[] calldata amounts,
        bytes32[] calldata secretHashes
    ) external {
        require(recipients.length == amounts.length, "length mismatch");
        require(amounts.length == secretHashes.length, "length mismatch");

        uint256 totalNeeded = 0;
        for (uint256 i = 0; i < amounts.length; i++) {
            totalNeeded += amounts[i];
        }

        // Mint from faucet — may need multiple calls since mint() gives a fixed amount
        uint256 mintAmt = IFeeAssetHandler(feeAssetHandler).mintAmount();
        uint256 mintsNeeded = (totalNeeded + mintAmt - 1) / mintAmt;
        for (uint256 i = 0; i < mintsNeeded; i++) {
            IFeeAssetHandler(feeAssetHandler).mint(address(this));
        }

        // Approve portal for total amount
        IERC20(feeJuice).approve(portal, totalNeeded);

        // Deposit for each recipient
        for (uint256 i = 0; i < recipients.length; i++) {
            IFeeJuicePortal(portal).depositToAztecPublic(recipients[i], amounts[i], secretHashes[i]);
        }
    }

    /**
     * @notice Bridge tokens (already held by the user) to multiple recipients atomically.
     *         The user must approve this contract for the total amount first.
     * @param feeJuice    Address of the fee juice ERC20 token
     * @param portal      Address of the FeeJuicePortal
     * @param recipients  Aztec addresses of the recipients
     * @param amounts     Amounts for each recipient
     * @param secretHashes Secret hashes for each claim
     */
    function bridgeMultiple(
        address feeJuice,
        address portal,
        bytes32[] calldata recipients,
        uint256[] calldata amounts,
        bytes32[] calldata secretHashes
    ) external {
        require(recipients.length == amounts.length, "length mismatch");
        require(amounts.length == secretHashes.length, "length mismatch");

        uint256 totalAmount = 0;
        for (uint256 i = 0; i < amounts.length; i++) {
            totalAmount += amounts[i];
        }

        // Pull tokens from sender
        IERC20(feeJuice).transferFrom(msg.sender, address(this), totalAmount);

        // Approve portal
        IERC20(feeJuice).approve(portal, totalAmount);

        // Deposit for each recipient
        for (uint256 i = 0; i < recipients.length; i++) {
            IFeeJuicePortal(portal).depositToAztecPublic(recipients[i], amounts[i], secretHashes[i]);
        }
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
